"""On-demand cloud snapshots. No background collector or local persistence."""
from collections import OrderedDict
import asyncio
import os
import time
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .cloud_cache import RedisCache, CacheLimited, CacheUnavailable
from .combined import CombinedProvider
from .config import Settings
from .contracts import Observation, SourceStatus, Track, Snapshot, PhaseEstimate, MovementSummary
from .movements import day_bounds
from .provider import AdsbFiProvider, FlyItalyProvider
from .service import FeedService


class CloudFeed:
    def __init__(self, cache, client, settings, clock=time.time, providers=None):
        self.cache, self.client, self.settings, self.clock = cache, client, settings, clock
        self.providers = providers

    def render(self, frame):
        snapshot = Snapshot.model_validate(frame)
        now = self.clock()
        counts = snapshot.status.movements
        if counts is not None:
            day,start,_ = day_bounds(now)
            if counts.day != day:
                counts = MovementSummary(day=day,available=counts.available)
                snapshot.status.movements = counts
            counts.unmonitored_seconds = max(0,now-start-counts.observed_seconds)
        snapshot.tracks = [t for t in snapshot.tracks
            if 0 <= now-(t.latest.position_time or t.latest.receipt_time) <= 120]
        for track in snapshot.tracks:
            if track.latest.position_time is None or now-track.latest.position_time>20:
                track.phase = PhaseEstimate(reasons=['Position is delayed, stale or has unknown timing'])
        for source in snapshot.status.sources.values():
            if source.enabled and source.state not in ('paused','waiting') and (source.last_success is None or now-source.last_success>60):
                source.state='unavailable'
        active = [s for s in snapshot.status.sources.values() if s.enabled]
        available = any(s.last_success is not None and now-s.last_success<=60 for s in active)
        snapshot.status.upstream_state = 'unavailable' if not available else 'healthy' if all(s.state=='healthy' for s in active) else 'degraded'
        return snapshot

    async def snapshot(self, viewer):
        claim = await self.cache.claim(viewer)
        previous = claim.state or {}
        if not claim.token:
            if not previous.get('snapshot'): raise CacheUnavailable()
            return self.render(previous['snapshot'])
        primary, regional = self.providers or (AdsbFiProvider(self.client,self.clock),
            FlyItalyProvider(self.client,self.settings.flyitaly_api_key,self.clock) if self.settings.flyitaly_enabled else None)
        checkpoint_lock = asyncio.Lock()
        reserved = {}
        async def checkpoint():
            async with checkpoint_lock:
                await self.cache.checkpoint(claim.token, {**previous,
                    'sources':{k:{**v.model_dump(mode='json'), **({'next_retry':reserved[k]} if k in reserved else {})} for k,v in provider.sources.items()},
                    'observations':{k:[o.model_dump(mode='json') for o in v] for k,v in provider.cache.items()},
                    'failures':dict(provider.failures)})
        class DurableProvider(CombinedProvider):
            async def _poll(inner, name):
                source = inner.sources[name]
                deadline = source.next_retry
                # Reserve before I/O: a crash cannot restart an in-flight poll.
                source.next_retry = self.clock()+300
                reserved[name] = source.next_retry
                await checkpoint()
                source.next_retry = deadline
                await super()._poll(name)
                reserved.pop(name,None)
                # Persist denial/retry outcomes before unrelated source/render work.
                await checkpoint()
        provider = DurableProvider(primary, clock=self.clock, primary_interval=15, regional=regional)
        # Restore retry deadlines even when every source failed; a new instance
        # must not reset a provider's denial, quota pause, or Retry-After.
        for name, source in previous.get('sources', {}).items():
            if provider.providers.get(name) is not None:
                provider.sources[name] = SourceStatus.model_validate(source)
                provider.cache[name] = [Observation.model_validate(o) for o in previous.get('observations',{}).get(name,[])]
                provider.failures[name] = previous.get('failures',{}).get(name,0)
        feed = FeedService(Settings(live_enabled=True, movement_db=':memory:'), provider, self.clock)
        try:
            if 'movements' in previous:
                feed.movements.restore_state(previous['movements'])
            if previous.get('snapshot'):
                old = Snapshot.model_validate(previous['snapshot'])
                feed.epoch, feed.sequence = old.epoch, old.sequence
                feed.store.tracks = OrderedDict((t.id,t) for t in old.tracks)
            await feed.poll_once()
            while provider.pending:
                await feed.poll_once()
            frame = feed.snapshot()
            frame.status.collection_mode = 'on_demand'
            frame.status.message = 'Shared updates while viewing · daily detected counts have partial coverage'
            for track in frame.tracks:
                track.history = track.history[-12:]
            state = {'snapshot':frame.model_dump(mode='json'),
                'sources':{k:v.model_dump(mode='json') for k,v in provider.sources.items()},
                'observations':{k:[o.model_dump(mode='json') for o in v] for k,v in provider.cache.items()},
                'failures':provider.failures,
                'movements':feed.movements.export_state()}
            if not await self.cache.publish(claim.token,state): raise CacheUnavailable()
            return self.render(state['snapshot'])
        finally:
            await provider.close()
            feed.movements.close()


def create_cloud_app(settings=None):
    app = FastAPI(title='Changi Observatory cloud feed')
    app.add_middleware(CORSMiddleware,allow_origins=['https://perryong.github.io','http://127.0.0.1:4177'],
        allow_methods=['GET'], expose_headers=['Retry-After','X-Response-Time','Age'])
    @app.get('/api/health')
    def health():
        return {'ok':True,'collection_mode':'on_demand','refresh_seconds':15,'durable_counts':True}

    @app.get('/api/aircraft')
    async def aircraft(request:Request):
        if request.query_params:
            return JSONResponse({'error':'Query parameters are not supported'},status_code=400)
        config = settings or Settings.from_env()
        if not config.live_enabled:
            return JSONResponse({'error':'Live data is not enabled'},status_code=503,headers={'Retry-After':'60'})
        # Vercel overwrites x-vercel-forwarded-for. Ignore caller-supplied generic XFF.
        viewer = request.headers.get('x-vercel-forwarded-for') if os.getenv('VERCEL') else request.client.host if request.client else 'unknown'
        async with httpx.AsyncClient(follow_redirects=False) as client:
            cache = RedisCache(client,os.getenv('KV_REST_API_URL',os.getenv('UPSTASH_REDIS_REST_URL','')),
                os.getenv('KV_REST_API_TOKEN',os.getenv('UPSTASH_REDIS_REST_TOKEN','')),
                prefix='changi:cloud:'+os.getenv('CLOUD_CACHE_VERSION','v1'))
            try:
                snapshot = await CloudFeed(cache,client,config).snapshot(viewer or 'unknown')
                return JSONResponse(snapshot.model_dump(mode='json'),headers={
                    'Cache-Control':'no-store',
                    'X-Response-Time':str(time.time()),
                    'Vercel-CDN-Cache-Control':'public, s-maxage=5',
                })
            except CacheLimited:
                return JSONResponse({'error':'Request limit reached; retry shortly'},status_code=429,
                    headers={'Retry-After':'60','Cache-Control':'no-store'})
            except (CacheUnavailable, ValueError):
                return JSONResponse({'error':'Shared feed temporarily unavailable'},status_code=503,
                    headers={'Retry-After':'60','Cache-Control':'no-store'})
    return app

app = create_cloud_app()

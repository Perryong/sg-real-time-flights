import asyncio
import contextlib
import json
import time
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from .geocoding import router as geocoding_router
from .weather import router as weather_router
from .config import Settings, ROOT
from .provider import AdsbFiProvider, FlyItalyProvider
from .opensky import OpenSkyGroundProvider
from .combined import CombinedProvider
from .service import FeedService
from .journey import JourneyCache, JourneyService, find_observation, journey_response

def load_airport():
    manifest=ROOT/'data/airport/manifest.json'
    if not manifest.exists():
        return {'name':'Singapore Changi','edition':'unverified','sources':[],'caveat':'Geometry sourcing in progress',**{k:{'type':'FeatureCollection','features':[]} for k in ('runways','taxiways','buildings')}}
    result=json.loads(manifest.read_text())
    for layer in ('runways','taxiways','buildings'):
        result[layer]=json.loads((manifest.parent/f'{layer}.geojson').read_text())
    return result

def create_app(settings=None, provider=None, clock=time.time):
    settings=settings or Settings.from_env()
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(follow_redirects=False) as client:
            ground=OpenSkyGroundProvider(client,settings.opensky_client_id,settings.opensky_client_secret,clock) if settings.opensky_enabled else None
            regional=FlyItalyProvider(client,settings.flyitaly_api_key,clock) if settings.flyitaly_enabled else None
            collector=provider or CombinedProvider(AdsbFiProvider(client,clock),ground,clock,
                primary_interval=settings.poll_seconds,ground_reason=settings.opensky_reason,regional=regional)
            feed=FeedService(settings,collector,clock)
            app.state.feed=feed
            cache=JourneyCache(clock, daily_limit=settings.aeroapi_daily_request_limit)
            app.state.journey=JourneyService(client,settings.aeroapi_api_key,cache,clock)
            task=asyncio.create_task(feed.run())
            try: yield
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError): await task
                feed.movements.close()
                if hasattr(collector,'close'):await collector.close()
    app=FastAPI(title='Changi Observatory',lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(CORSMiddleware,allow_origins=list(settings.origins),allow_methods=['GET','POST'],allow_headers=['*'])
    app.include_router(geocoding_router)
    app.include_router(weather_router)
    @app.get('/api/health')
    def health(): return {'ok':True,'schema_version':1,'version':'0.1.0'}
    @app.get('/api/status')
    async def status(): return app.state.feed.status()
    @app.get('/api/aircraft')
    async def aircraft(): return app.state.feed.snapshot()
    @app.get('/api/journey')
    async def journey(request: Request):
        async def observed(callsign, hex_id, observed_at):
            return find_observation(app.state.feed.store.snapshot(clock()), callsign, hex_id, observed_at)
        return await journey_response(request, settings, getattr(app.state, 'journey', None), observed, clock)
    @app.get('/api/airport')
    def airport(): return load_airport()
    @app.get('/api/fixtures/{name}')
    def fixture(name: str):
        if name not in ('changi-demo','recorded-test'): raise HTTPException(404)
        path=ROOT/'tests/fixtures/scenarios/changi-demo.json'
        if not path.exists(): raise HTTPException(404,'Fixture unavailable')
        data=json.loads(path.read_text())
        if name=='recorded-test':
            for frame in data['frames']:
                frame['mode']='recorded';frame['status']['mode']='recorded';frame['status']['upstream_state']='recorded'
                frame['epoch']='recorded-synthetic-test-v1'
                for track in frame['tracks']:
                    track['id']=track['id'].replace('simulated:','recorded:',1)
                    for observation in [track['latest'],*track['history']]:
                        observation['mode']='recorded';observation['id']=track['id']
        return data
    @app.websocket('/ws/aircraft')
    async def stream(ws:WebSocket):
        if ws.headers.get('origin') not in settings.origins:
            await ws.close(code=1008); return
        await ws.accept(); feed=app.state.feed; q=feed.subscribe()
        try:
            await asyncio.wait_for(ws.send_json(feed.snapshot().model_dump(mode='json')),timeout=5)
            while True:
                try: payload=await asyncio.wait_for(q.get(),timeout=10)
                except asyncio.TimeoutError:
                    payload={'type':'heartbeat','epoch':feed.epoch,'sequence':feed.sequence,'server_time':clock(),'status':feed.status().model_dump(mode='json')}
                await asyncio.wait_for(ws.send_json(payload),timeout=5)
        except (WebSocketDisconnect,RuntimeError,asyncio.TimeoutError): pass
        finally: feed.clients.discard(q)
    return app

app=create_app()

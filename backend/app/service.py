import asyncio
import logging
import random
import time
import uuid
from .contracts import FeedStatus, Snapshot, PhaseEstimate
from .provider import ProviderError
from .store import TrackStore

log=logging.getLogger('changi.feed')

class FeedService:
    def __init__(self, settings, provider, clock=time.time):
        self.settings,self.provider,self.clock=settings,provider,clock
        self.store=TrackStore(); self.epoch=str(uuid.uuid4()); self.sequence=0
        self.last_attempt=None; self.last_success=None; self.next_retry=None
        self.error='configuration_required' if not settings.live_enabled else None
        self.paused=False; self.failures=0; self.clients=set(); self.lock=asyncio.Lock()
        self.counters={'requests':0,'invalid':0,'dropped_updates':0,'latency_ms':0}

    def status(self):
        now=self.clock(); age=now-self.last_success if self.last_success is not None else float('inf')
        state='unavailable' if age>60 else ('degraded' if self.error or age>30 else 'healthy')
        tracks=self.store.snapshot(now)
        timestamps=[t.latest.position_time for t in tracks if t.latest.position_time is not None]
        return FeedStatus(upstream_state=state,error_code=self.error,
            message=('Live observations available' if state=='healthy' else
                'Airplanes.live access and usage policy require verification. No live polling enabled.' if self.error=='configuration_required' else
                'Provider access denied; polling paused. Review configuration and restart.' if self.paused else
                'Feed interrupted. Positions retain their original timestamps.'),
            last_attempt=self.last_attempt,last_success=self.last_success,next_retry=self.next_retry,
            newest_position_time=max(timestamps,default=None),
            counters={**self.counters,'clients':len(self.clients),'tracked':len(tracks),'evictions':self.store.evictions})

    def snapshot(self):
        now=self.clock(); tracks=self.store.snapshot(now)
        output=[]
        for t in tracks:
            if t.latest.position_time is None or now-t.latest.position_time>20:
                t=t.model_copy(update={'phase':PhaseEstimate(reasons=['Position is delayed, stale or has unknown timing'])})
            output.append(t)
        return Snapshot(epoch=self.epoch,sequence=self.sequence,mode='live',server_time=now,status=self.status(),tracks=output)

    def subscribe(self):
        q=asyncio.Queue(maxsize=1); self.clients.add(q); return q

    def publish(self):
        payload=self.snapshot().model_dump(mode='json')
        for q in tuple(self.clients):
            if q.full(): q.get_nowait(); self.counters['dropped_updates']+=1
            q.put_nowait(payload)

    async def poll_once(self):
        async with self.lock:
            self.last_attempt=self.clock(); self.counters['requests']+=1
            start=time.monotonic()
            try:
                result=await self.provider.fetch()
                self.store.ingest(result.observations,self.clock())
                self.last_success=self.clock(); self.error='partial_data' if result.invalid else None
                self.counters['invalid']+=result.invalid; self.failures=0
                self.next_retry=self.clock()+self.settings.poll_seconds
            except ProviderError as e:
                self.error=e.code; self.paused=e.pause; self.failures+=1
                delay=e.retry_after if e.retry_after is not None else min(60,self.settings.poll_seconds*2**min(self.failures,4))+random.uniform(0,1)
                self.next_retry=None if self.paused else self.clock()+max(self.settings.poll_seconds,delay)
            self.counters['latency_ms']=round((time.monotonic()-start)*1000,1)
            self.sequence+=1; self.publish()
            log.info('feed_poll',extra={'status':self.error or 'ok','requests':self.counters['requests'],'tracks':len(self.store.tracks)})

    async def run(self):
        if not self.settings.live_enabled: return
        while not self.paused:
            await self.poll_once()
            if self.next_retry is not None: await asyncio.sleep(max(0,self.next_retry-self.clock()))

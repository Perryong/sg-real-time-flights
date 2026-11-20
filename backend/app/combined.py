"""Independently scheduled sources feeding one deduplicated aircraft view."""
import asyncio
import re
import time
from .contracts import SourceStatus
from .provider import ProviderError, ProviderResult

class CombinedProvider:
    def __init__(self,primary,ground=None,clock=time.time,primary_interval=10,ground_reason='disabled',regional=None):
        self.clock=clock
        self.providers={'adsb.fi':primary,'opensky':ground,'flyitalyadsb':regional}
        self.intervals={'adsb.fi':max(10,primary_interval),'opensky':30,'flyitalyadsb':30}
        self.cache={name:[] for name in self.providers}
        self.failures={name:0 for name in self.providers}
        self.pending={}
        self.invalid=0
        self.sources={name:SourceStatus(enabled=p is not None,state='waiting' if p else 'disabled',
            error_code=None if p else ground_reason if name=='opensky' else 'disabled') for name,p in self.providers.items()}

    def statuses(self):
        now=self.clock();result={}
        for name,s in self.sources.items():
            state=s.state
            if s.enabled and state not in ('paused','waiting') and (s.last_success is None or now-s.last_success>60):state='unavailable'
            result[name]=s.model_copy(update={'state':state})
        return result

    async def _poll(self,name):
        p=self.providers[name];s=self.sources[name];now=self.clock()
        if p is None or s.state=='paused' or (s.next_retry is not None and now<s.next_retry):return
        s.last_attempt=now;s.requests+=1
        try:
            result=await asyncio.wait_for(p.fetch(),timeout=10)
            self.cache[name]=result.observations
            self.invalid+=result.invalid
            self.failures[name]=0;s.last_success=self.clock()
            s.error_code='partial_data' if result.invalid else None
            s.state='degraded' if result.invalid else 'healthy'
            s.remaining_credits=getattr(p,'remaining_credits',None)
            s.next_retry=self.clock()+self.intervals[name]
            # Conservatively wait a full day when the account reports zero credits.
            if s.remaining_credits==0:
                s.next_retry=self.clock()+86400;s.error_code='quota_exhausted';s.state='degraded'
        except Exception as error:
            # Malformed upstream data must never terminate the other source's collector.
            # Cancellation remains a BaseException and is allowed to propagate.
            e=error if isinstance(error,ProviderError) else ProviderError('timeout' if isinstance(error,TimeoutError) else 'invalid_response')
            self.failures[name]+=1;s.error_code=e.code
            s.state='paused' if e.pause else 'degraded'
            delay=e.retry_after if e.retry_after is not None else min(300,self.intervals[name]*2**min(self.failures[name],4))
            s.next_retry=None if e.pause else self.clock()+max(self.intervals[name],delay)

    async def fetch(self):
        for name,p in self.providers.items():
            s=self.sources[name]
            if name not in self.pending and p is not None and s.state!='paused' and (s.next_retry is None or self.clock()>=s.next_retry):
                self.pending[name]=asyncio.create_task(self._poll(name))
        if self.pending:
            # Publish the first completed source immediately. Wake for another
            # source's deadline even if an existing request is still in flight.
            deadlines=[s.next_retry-self.clock() for name,s in self.sources.items()
                if name not in self.pending and s.enabled and s.state!='paused' and s.next_retry is not None]
            timeout=max(0,min(deadlines)) if deadlines else None
            await asyncio.wait(self.pending.values(),timeout=timeout,return_when=asyncio.FIRST_COMPLETED)
            for name,task in list(self.pending.items()):
                if task.done():
                    task.result()
                    del self.pending[name]
        now=self.clock();best={};routes={}
        for observations in self.cache.values():
            for o in observations:
                if o.position_time is not None and not 0<=now-o.position_time<=120:continue
                ident=o.provider_id.lower()
                key=f'live:icao24:{ident}' if re.fullmatch(r'[0-9a-f]{6}',ident) else o.id
                if o.route is not None and o.callsign and o.route.callsign==o.callsign.strip().upper():
                    routes[(key,o.route.callsign)]=o.route
                old=best.get(key)
                if old is None or (o.position_time or 0)>(old.position_time or 0):
                    best[key]=o.model_copy(update={'id':key})
        for key,o in best.items():
            route=routes.get((key,(o.callsign or '').strip().upper()))
            best[key]=o.model_copy(update={'route':route})
        if not any(s.last_success is not None and now-s.last_success<=60 for s in self.sources.values()):
            raise ProviderError('all_sources_unavailable')
        invalid=self.invalid;self.invalid=0
        return ProviderResult(list(best.values()),invalid)

    def next_poll_delay(self):
        if self.pending:return 0
        deadlines=[s.next_retry-self.clock() for s in self.sources.values()
            if s.enabled and s.state!='paused' and s.next_retry is not None]
        return max(0,min(deadlines)) if deadlines else 60

    async def close(self):
        for task in self.pending.values():task.cancel()
        await asyncio.gather(*self.pending.values(),return_exceptions=True)
        self.pending.clear()

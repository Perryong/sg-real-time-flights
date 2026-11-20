import pytest
import asyncio
import time
from backend.app import combined
from backend.app.provider import ProviderResult, ProviderError
from backend.app.normalize import normalize_record
from backend.app.store import TrackStore

NOW=1700000000
def observation(source='adsb.fi',position=NOW,ground=False):
    o=normalize_record({'hex':'abc123','lat':1.36,'lon':103.99,'seen_pos':0,'alt_baro':'ground' if ground else 1000},position,NOW,'live',True)
    return o.model_copy(update={'provider':source,'id':f'live:{source}:abc123'})

class Fake:
    def __init__(self,result):self.result=result;self.calls=0;self.remaining_credits=None
    async def fetch(self):
        self.calls+=1
        if isinstance(self.result,Exception):raise self.result
        return ProviderResult(self.result,0)

@pytest.mark.asyncio
async def test_independent_schedule_and_newest_observation_wins_without_duplicates():
    now=[NOW]; primary=Fake([observation()]); secondary=Fake([observation('opensky',NOW-1,True)])
    p=combined.CombinedProvider(primary,secondary,clock=lambda:now[0])
    first=(await p.fetch()).observations
    assert len(first)==1 and first[0].provider=='adsb.fi'
    assert first[0].id=='live:icao24:abc123'
    now[0]+=10;await p.fetch(); now[0]+=10;await p.fetch()
    assert primary.calls==3 and secondary.calls==1
    now[0]+=10;await p.fetch()
    assert secondary.calls==2

@pytest.mark.asyncio
async def test_ground_failure_does_not_pause_primary_and_retry_after_is_respected():
    now=[NOW]; primary=Fake([observation()]); secondary=Fake(ProviderError('429',retry_after=600))
    p=combined.CombinedProvider(primary,secondary,clock=lambda:now[0])
    assert len((await p.fetch()).observations)==1
    now[0]+=30;await p.fetch()
    assert primary.calls==2 and secondary.calls==1
    assert p.statuses()['opensky'].error_code=='429'
    assert p.statuses()['adsb.fi'].state=='healthy'

@pytest.mark.asyncio
async def test_ground_survives_primary_access_denial_and_no_secret_enters_status():
    primary=Fake(ProviderError('403',pause=True)); secondary=Fake([observation('opensky',NOW,True)])
    p=combined.CombinedProvider(primary,secondary,clock=lambda:NOW)
    result=await p.fetch();await p.fetch()
    assert result.observations[0].provider=='opensky'
    assert primary.calls==1
    assert p.statuses()['adsb.fi'].state=='paused'

@pytest.mark.asyncio
async def test_disabled_secondary_never_calls_and_reports_permission_requirement():
    p=combined.CombinedProvider(Fake([]),None,ground_reason='permission_required',clock=lambda:NOW)
    await p.fetch()
    assert p.statuses()['opensky'].enabled is False
    assert p.statuses()['opensky'].error_code=='permission_required'

@pytest.mark.asyncio
async def test_cache_does_not_refresh_position_time_or_resurrect_stale_ground():
    now=[NOW]; secondary=Fake([observation('opensky',NOW,True)])
    p=combined.CombinedProvider(Fake([]),secondary,clock=lambda:now[0])
    result=await p.fetch();assert result.observations[0].position_time==NOW
    secondary.result=ProviderError('network_or_json')
    now[0]+=30;result=await p.fetch();assert result.observations[0].position_time==NOW
    now[0]+=91;assert (await p.fetch()).observations==[]

def test_source_switch_resets_history_without_creating_another_track():
    s=TrackStore();first=observation().model_copy(update={'id':'live:icao24:abc123'})
    second=observation('opensky',NOW,True).model_copy(update={'id':first.id,'position_time':NOW+1,'receipt_time':NOW+1})
    s.ingest([first],NOW);s.ingest([second],NOW+1)
    assert len(s.snapshot(NOW+1))==1
    assert len(s.snapshot(NOW+1)[0].history)==1

@pytest.mark.asyncio
async def test_slow_ground_source_does_not_delay_primary_publication():
    gate=asyncio.Event()
    class Slow:
        async def fetch(self):
            await gate.wait()
            return ProviderResult([],0)
    p=combined.CombinedProvider(Fake([observation()]),Slow(),clock=lambda:NOW)
    try:
        result=await asyncio.wait_for(p.fetch(),.1)
        assert len(result.observations)==1
    finally:
        gate.set()
        if hasattr(p,'close'):await p.close()

@pytest.mark.asyncio
async def test_unexpected_ground_error_is_contained_and_primary_keeps_polling():
    now=[NOW];primary=Fake([observation()])
    p=combined.CombinedProvider(primary,Fake(OverflowError('private upstream data')),clock=lambda:now[0])
    await p.fetch();now[0]+=10;await p.fetch()
    assert primary.calls==2
    assert p.statuses()['opensky'].error_code=='invalid_response'

@pytest.mark.asyncio
async def test_invalid_counts_are_reported_once_per_actual_source_response():
    class Partial:
        async def fetch(self):return ProviderResult([],3)
    p=combined.CombinedProvider(Partial(),clock=lambda:NOW)
    assert (await p.fetch()).invalid==3
    assert (await p.fetch()).invalid==0

@pytest.mark.asyncio
async def test_zero_credits_halts_only_ground_until_next_day():
    now=[NOW];primary=Fake([]);ground=Fake([]);ground.remaining_credits=0
    p=combined.CombinedProvider(primary,ground,clock=lambda:now[0])
    await p.fetch();now[0]+=60;await p.fetch()
    assert ground.calls==1 and primary.calls==2
    assert p.statuses()['opensky'].next_retry==NOW+86400

@pytest.mark.asyncio
async def test_primary_deadline_wakes_collector_while_ground_is_pending():
    gate=asyncio.Event();primary=Fake([])
    class Slow:
        async def fetch(self):
            await gate.wait()
            return ProviderResult([],0)
    p=combined.CombinedProvider(primary,Slow(),clock=time.time)
    p.intervals['adsb.fi']=.02
    try:
        await p.fetch()
        assert primary.calls==1 and p.next_poll_delay()==0
        await asyncio.wait_for(p.fetch(),.2)
        await asyncio.wait_for(p.fetch(),.2)
        assert primary.calls==2 and not gate.is_set()
    finally:await p.close()

@pytest.mark.asyncio
async def test_public_last_success_does_not_advance_on_cache_only_cycle():
    from backend.app.service import FeedService
    from backend.app.config import Settings
    now=[NOW]
    p=combined.CombinedProvider(Fake([]),clock=lambda:now[0])
    feed=FeedService(Settings(live_enabled=True),p,clock=lambda:now[0])
    await feed.poll_once();now[0]+=5;await feed.poll_once()
    assert feed.status().last_success==NOW

@pytest.mark.asyncio
async def test_regional_supplement_adds_aircraft_deduplicates_and_polls_every_30_seconds():
    now=[NOW];extra=observation('flyitalyadsb',NOW,True).model_copy(update={'provider_id':'def456'})
    regional=Fake([observation('flyitalyadsb',NOW-1),extra])
    p=combined.CombinedProvider(Fake([observation()]),regional=regional,clock=lambda:now[0])
    result=await p.fetch()
    assert len(result.observations)==2
    assert {o.provider for o in result.observations}=={'adsb.fi','flyitalyadsb'}
    now[0]+=10;await p.fetch();assert regional.calls==1
    now[0]+=20;await p.fetch();assert regional.calls==2
    regional.result=ProviderError('403',pause=True)
    now[0]+=30;await p.fetch()
    assert p.statuses()['flyitalyadsb'].state=='paused'
    assert p.statuses()['adsb.fi'].state=='healthy'

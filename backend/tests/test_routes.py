import httpx
import pytest
from backend.app.provider import FlyItalyProvider, ProviderResult
from backend.app.combined import CombinedProvider
from backend.app.store import TrackStore
from backend.app.normalize import normalize_record

NOW=1795183200
ROUTE={'from':'YPPH','from_iata':'PER','to':'WSSS','to_iata':'SIN','count':7,'last_day':'2026-11-19','source':'observed'}

async def observation(route=ROUTE):
    raw={'hex':'abc123','flight':'SIA214 ','lat':1.4,'lon':104,'seen_pos':0,'alt_baro':30000,'route':route}
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'now':NOW,'ac':[raw]}))) as c:
        return (await FlyItalyProvider(c,'test-key',lambda:NOW).fetch()).observations[0]

@pytest.mark.asyncio
async def test_historical_route_keeps_provenance_and_callsign():
    o=await observation()
    assert o.route.origin=='YPPH' and o.route.destination=='WSSS'
    assert o.route.callsign=='SIA214' and o.route.observed_count==7
    assert o.route.provider=='flyitalyadsb' and o.route.retrieved_at==NOW
    assert o.route.last_seen_day=='2026-11-19'
    assert 'test-key' not in o.model_dump_json()

@pytest.mark.asyncio
@pytest.mark.parametrize('route',[None,[],{},dict(ROUTE,count=True),dict(ROUTE,count=-1),dict(ROUTE,to='bad'),dict(ROUTE,last_day='2026-02-30'),dict(ROUTE,last_day='2026-11-30'),dict(ROUTE,last_day='2025-11-19'),dict(ROUTE,source='schedule')])
async def test_bad_route_is_discarded_without_discarding_position(route):
    o=await observation(route)
    assert o.lat==1.4 and o.route is None

@pytest.mark.asyncio
@pytest.mark.parametrize('callsign,expect_route',[('SIA214',True),('SIA215',False),(None,False)])
async def test_route_merges_with_newer_position_only_for_matching_flight(callsign,expect_route):
    regional=await observation()
    primary=normalize_record({'hex':'abc123','flight':callsign,'lat':1.4,'lon':104,'seen_pos':0},NOW+1,NOW+1,'live',True)
    class Fake:
        def __init__(self,o):self.o=o
        async def fetch(self):return ProviderResult([self.o],0)
    combined=CombinedProvider(Fake(primary),regional=Fake(regional),clock=lambda:NOW+1)
    await combined.fetch()
    result=await combined.fetch()
    o=result.observations[0]
    assert len(result.observations)==1 and o.provider=='adsb.fi' and o.position_time==NOW+1
    assert (o.route is not None)==expect_route
    await combined.close()

@pytest.mark.asyncio
async def test_metadata_refresh_does_not_renew_position_or_history():
    o=await observation();store=TrackStore()
    store.ingest([o.model_copy(update={'route':None})],NOW)
    store.ingest([o],NOW+10)
    t=store.snapshot(NOW+10)[0]
    assert t.latest.route is not None and t.latest.position_time==NOW and len(t.history)==1
    store.ingest([o.model_copy(update={'route':None})],NOW+20)
    assert store.snapshot(NOW+20)[0].latest.route is None

@pytest.mark.asyncio
async def test_equal_position_callsign_change_invalidates_old_route():
    o=await observation();store=TrackStore();store.ingest([o],NOW)
    changed=o.model_copy(update={'callsign':'SIA215','route':None,'receipt_time':NOW+5})
    store.ingest([changed],NOW+5)
    t=store.snapshot(NOW+5)[0]
    assert t.latest.route is None
    assert t.latest.position_time==NOW and len(t.history)==1

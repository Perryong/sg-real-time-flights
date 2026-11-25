import pytest
from fastapi.testclient import TestClient
from backend.app.cloud import create_cloud_app,CloudFeed
from backend.app.config import Settings
from backend.app.regions import REGIONS
from backend.tests.test_cloud import redis_port,command,cache_factory
from backend.app.cloud_cache import CacheLimited

@pytest.mark.asyncio
async def test_region_caches_isolate_frames_but_share_viewer_budget(cache_factory):
    a=cache_factory('region-a');b=cache_factory('region-b')
    a.rate_prefix=b.rate_prefix='global-region-test'
    owner=await a.claim('person');await a.publish(owner.token,{'value':'singapore'})
    owner=await b.claim('person');assert owner.state is None
    await b.publish(owner.token,{'value':'london'})
    for _ in range(3):
        assert (await a.claim('person')).state=={'value':'singapore'}
        assert (await b.claim('person')).state=={'value':'london'}
    with pytest.raises(CacheLimited):await b.claim('person')

def test_region_allowlist_and_unconfigured_region_fail_closed():
    assert set(REGIONS)=={'singapore','london','tokyo'}
    with TestClient(create_cloud_app(Settings(live_enabled=True))) as client:
        for query in ('region=unknown','url=https://example.com','region=london&region=tokyo','region=london&lat=1'):
            assert client.get('/api/aircraft?'+query).status_code==400
        assert client.get('/api/aircraft?region=london').status_code==503

@pytest.mark.asyncio
async def test_foreign_frame_has_no_changi_movements_or_phase(cache_factory):
    import httpx
    from backend.app.provider import FlyItalyProvider
    async def transport(request):
        assert '/lat/51.47/lon/-0.4543/dist/200' in str(request.url)
        return httpx.Response(200,json={'now':1000,'ac':[{'hex':'abc123','lat':51.5,'lon':-0.4,'alt_baro':10000,'gs':200,'track':90,'seen_pos':0}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        frame=await CloudFeed(cache_factory(),client,Settings(live_enabled=True,flyitaly_enabled=True,flyitaly_api_key='test'),clock=lambda:1000,region='london').snapshot('test')
        assert frame.status.movements is None
        assert frame.tracks and frame.tracks[0].phase.candidate_runways==[]
        assert frame.status.sources['adsb.fi'].enabled is False

@pytest.mark.asyncio
async def test_global_budget_shared_across_regions_and_viewers(cache_factory,command):
    # Redis budgets reset at minute boundaries, including during this test.
    for attempt in range(3):
        minute=int(command('TIME')[0])//60
        a=cache_factory();b=cache_factory()
        a.rate_prefix=b.rate_prefix=a.prefix+'-shared-global-budget'
        for i in range(60):
            await (a if i%2 else b).claim('viewer-'+str(i))
        limited=[]
        for cache,viewer in ((a,'new-viewer'),(b,'another-viewer')):
            try: await cache.claim(viewer)
            except CacheLimited: limited.append(True)
        if int(command('TIME')[0])//60 == minute:
            assert len(limited)==2
            return
    pytest.fail('Could not exercise shared limits within one Redis minute')

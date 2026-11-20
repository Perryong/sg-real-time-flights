import httpx
import pytest
from backend.app import opensky
from backend.app.provider import ProviderError

NOW = 1700000000

def row(hex='abc123', ground=True, position=NOW-5, category=4):
    return [hex, ' TEST 1 ', 'Singapore', position, NOW-1, 103.99, 1.36,
            None, ground, 0, 90, None, None, None, None, False, 0, category]

def reply(request, rows=None):
    if request.url.host == 'auth.opensky-network.org':
        assert request.method == 'POST'
        assert 'authorization' not in request.headers
        return httpx.Response(200, json={'access_token':'test-token','expires_in':1800})
    assert request.headers['authorization'] == 'Bearer test-token'
    assert dict(request.url.params) == {'lamin':'1.3','lamax':'1.4','lomin':'103.965','lomax':'104.03','extended':'1'}
    return httpx.Response(200, json={'time':NOW,'states':rows if rows is not None else [row()]})

@pytest.mark.asyncio
async def test_ground_adapter_keeps_source_time_and_units_and_reuses_token():
    calls=[]; now=[NOW]
    def respond(r): calls.append(r.url.host); return reply(r)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as c:
        p=opensky.OpenSkyGroundProvider(c,'test-client','test-secret',clock=lambda:now[0])
        o=(await p.fetch()).observations[0]
        assert o.provider=='opensky' and o.provider_id=='abc123'
        assert o.position_time==NOW-5 and o.message_time==NOW-1
        assert o.receipt_time==NOW and o.ground is True
        assert o.speed_mps==0 and o.alt_baro_m is None and o.callsign=='TEST 1'
        await p.fetch()
        assert calls.count('auth.opensky-network.org')==1
        now[0]+=1780
        await p.fetch()
        assert calls.count('auth.opensky-network.org')==2

@pytest.mark.asyncio
async def test_only_fresh_ground_aircraft_inside_airport_are_admitted():
    outside=row('abc124'); outside[6]=1.6
    malformed=row('abc125'); malformed[5]=float('nan')
    rows=[row(),row('abc126',False),row('abc127',position=None),row('abc128',position=NOW+1),
          row('abc129',position=NOW-121),row('abc130',category=17),row('abc131',category=18),outside,
          ['short'],row('nothex'),row('abc132',ground=1)]
    # JSON cannot carry NaN, so exercise the parser separately below.
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:reply(r,rows))) as c:
        result=await opensky.OpenSkyGroundProvider(c,'id','secret',clock=lambda:NOW).fetch()
        assert [o.provider_id for o in result.observations]==['abc123']
    assert opensky.normalize_ground(malformed,NOW,NOW) is None

@pytest.mark.parametrize('category',[None,0,1,13,16,17,18,19,20])
def test_unclassified_contacts_and_non_aircraft_are_not_counted_as_airplanes(category):
    assert opensky.normalize_ground(row(category=category),NOW,NOW) is None

@pytest.mark.asyncio
async def test_auth_denial_is_sanitized_and_pauses_only_this_source():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(401,text='test-secret'))) as c:
        with pytest.raises(ProviderError) as e:
            await opensky.OpenSkyGroundProvider(c,'id','test-secret',clock=lambda:NOW).fetch()
        assert e.value.pause and 'test-secret' not in str(e.value)

@pytest.mark.asyncio
async def test_states_401_discards_token_and_recovers_on_next_scheduled_call():
    count={'auth':0,'data':0}
    def respond(r):
        if r.url.host=='auth.opensky-network.org':count['auth']+=1; return reply(r)
        count['data']+=1
        return httpx.Response(401) if count['data']==1 else reply(r)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as c:
        p=opensky.OpenSkyGroundProvider(c,'id','secret',clock=lambda:NOW)
        with pytest.raises(ProviderError) as e: await p.fetch()
        assert not e.value.pause
        assert len((await p.fetch()).observations)==1
        assert count=={'auth':2,'data':2}

@pytest.mark.asyncio
async def test_quota_header_and_empty_states_are_supported():
    def respond(r):
        if r.url.host=='auth.opensky-network.org':return reply(r)
        return httpx.Response(429,headers={'X-Rate-Limit-Retry-After-Seconds':'3600'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as c:
        with pytest.raises(ProviderError) as e:await opensky.OpenSkyGroundProvider(c,'id','secret',clock=lambda:NOW).fetch()
        assert e.value.retry_after==3600
    def empty(r):
        if r.url.host=='auth.opensky-network.org':return reply(r)
        return httpx.Response(200,json={'time':NOW,'states':None},headers={'X-Rate-Limit-Remaining':'0'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(empty)) as c:
        p=opensky.OpenSkyGroundProvider(c,'id','secret',clock=lambda:NOW)
        assert (await p.fetch()).observations==[]
        assert p.remaining_credits==0

@pytest.mark.asyncio
@pytest.mark.parametrize('payload',[{}, {'time':NOW,'states':'bad'}, {'time':NOW+1,'states':[row()]}, {'time':NOW*1000,'states':[row()]}])
async def test_malformed_payload_is_not_a_healthy_empty_response(payload):
    def respond(r):
        return reply(r) if r.url.host=='auth.opensky-network.org' else httpx.Response(200,json=payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as c:
        with pytest.raises(ProviderError):await opensky.OpenSkyGroundProvider(c,'id','secret',clock=lambda:NOW).fetch()

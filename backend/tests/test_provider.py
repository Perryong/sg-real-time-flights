import httpx
import pytest
from backend.app.provider import AdsbFiProvider, ProviderError

@pytest.mark.asyncio
async def test_valid_empty_and_partial_records():
    for payload, valid, invalid in [({'now':1700000000000,'ac':[]},0,0),({'now':1700000000000,'ac':[{'hex':'a','lat':1,'lon':104,'seen_pos':0},{'lat':99}]},1,1)]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as c:
            result=await AdsbFiProvider(c,clock=lambda:1700000001).fetch()
            assert len(result.observations)==valid
            assert result.invalid==invalid

@pytest.mark.asyncio
@pytest.mark.parametrize('code,pause,retry',[(401,True,None),(403,True,None),(429,False,120),(500,False,None)])
async def test_http_failures_have_bounded_policy(code,pause,retry):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(code,headers={'Retry-After':'120'}))) as c:
        with pytest.raises(ProviderError) as e: await AdsbFiProvider(c).fetch()
        assert e.value.pause is pause
        assert e.value.retry_after==retry

@pytest.mark.asyncio
async def test_invalid_payload_and_timeout_never_succeed():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'oops':[]}))) as c:
        with pytest.raises(ProviderError): await AdsbFiProvider(c).fetch()
    def timeout(r): raise httpx.ReadTimeout('timeout')
    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as c:
        with pytest.raises(ProviderError): await AdsbFiProvider(c).fetch()

@pytest.mark.asyncio
async def test_http_date_retry_after():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(429,headers={'Retry-After':'Tue, 14 Nov 2023 22:15:20 GMT'}))) as c:
        with pytest.raises(ProviderError) as e: await AdsbFiProvider(c,clock=lambda:1700000000).fetch()
        assert e.value.retry_after==120

@pytest.mark.asyncio
async def test_changi_v3_request_preserves_source_times_and_identity():
    def respond(request):
        assert str(request.url) == 'https://opendata.adsb.fi/api/v3/lat/1.3644/lon/103.9915/dist/100'
        assert 'authorization' not in request.headers
        return httpx.Response(200, json={'now':1700000000000, 'msg':'No error', 'ac':[
            {'hex':'ABC123','lat':1.35,'lon':104,'seen_pos':2.5,'seen':1,'alt_baro':1000,'gs':0},
            {'hex':'DEF456','lat':2.8,'lon':104,'seen_pos':1,'alt_baro':12000},
            {'hex':'FED321','lat':1.36,'lon':103.99,'seen_pos':0,'alt_baro':'ground'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result=await AdsbFiProvider(client,clock=lambda:1700000001).fetch()
    assert len(result.observations) == 3
    assert result.observations[1].callsign is None
    assert result.observations[1].lat == 2.8
    assert result.observations[2].ground is True
    o=result.observations[0]
    assert o.id == 'live:adsb.fi:abc123'
    assert o.provider == 'adsb.fi'
    assert o.provider_time == 1700000000
    assert o.position_time == 1699999997.5
    assert o.message_time == 1699999999
    assert o.receipt_time == 1700000001
    assert o.alt_baro_m == 304.8 and o.speed_mps == 0

@pytest.mark.asyncio
@pytest.mark.parametrize('now', [None,1700000000,1700000060000])
async def test_missing_wrong_unit_or_future_clock_cannot_be_fresh(now):
    payload={'now':now,'ac':[{'hex':'a','lat':1,'lon':104,'seen_pos':0}]}
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as client:
        o=(await AdsbFiProvider(client,clock=lambda:1700000001).fetch()).observations[0]
    assert o.position_time is None
    assert o.timestamp_quality == 'unknown'

@pytest.mark.asyncio
async def test_provider_error_inside_http_success_is_not_empty_success():
    payload={'now':1700000000000,'msg':'Service unavailable','ac':[]}
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as client:
        with pytest.raises(ProviderError, match='provider_error'):
            await AdsbFiProvider(client).fetch()

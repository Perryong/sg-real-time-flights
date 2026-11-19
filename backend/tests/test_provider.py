import httpx
import pytest
from backend.app.provider import AirplanesProvider, ProviderError

@pytest.mark.asyncio
async def test_valid_empty_and_partial_records():
    for payload, valid, invalid in [({'now':1700000000,'ac':[]},0,0),({'now':1700000000,'ac':[{'hex':'a','lat':1,'lon':104,'seen_pos':0},{'lat':99}]},1,1)]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as c:
            result=await AirplanesProvider(c,clock=lambda:1700000001).fetch()
            assert len(result.observations)==valid
            assert result.invalid==invalid

@pytest.mark.asyncio
@pytest.mark.parametrize('code,pause,retry',[(401,True,None),(403,True,None),(429,False,120),(500,False,None)])
async def test_http_failures_have_bounded_policy(code,pause,retry):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(code,headers={'Retry-After':'120'}))) as c:
        with pytest.raises(ProviderError) as e: await AirplanesProvider(c).fetch()
        assert e.value.pause is pause
        assert e.value.retry_after==retry

@pytest.mark.asyncio
async def test_invalid_payload_and_timeout_never_succeed():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'oops':[]}))) as c:
        with pytest.raises(ProviderError): await AirplanesProvider(c).fetch()
    def timeout(r): raise httpx.ReadTimeout('timeout')
    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as c:
        with pytest.raises(ProviderError): await AirplanesProvider(c).fetch()

@pytest.mark.asyncio
async def test_http_date_retry_after():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(429,headers={'Retry-After':'Tue, 14 Nov 2023 22:15:20 GMT'}))) as c:
        with pytest.raises(ProviderError) as e: await AirplanesProvider(c,clock=lambda:1700000000).fetch()
        assert e.value.retry_after==120

import httpx
import pytest
from backend.app import provider
from backend.app.config import Settings

NOW=1700000000

@pytest.mark.asyncio
async def test_flyitaly_uses_private_key_kilometres_seconds_and_actual_provenance():
    def respond(request):
        assert str(request.url)=='https://api.flyitalyadsb.com/v2/lat/1.3644/lon/103.9915/dist/500?with=route'
        assert request.headers['x-api-key']=='test-private-key'
        return httpx.Response(200,json={'now':NOW,'count':1,'ac':[
            {'hex':'ABC123','lat':1.36,'lon':103.99,'seen_pos':2,'seen':1,'alt_baro':'ground','gs':0}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        o=(await provider.FlyItalyProvider(client,'test-private-key',clock=lambda:NOW+1).fetch()).observations[0]
    assert o.provider=='flyitalyadsb' and o.id=='live:flyitalyadsb:abc123'
    assert o.provider_time==NOW and o.position_time==NOW-2
    assert o.ground is True and o.speed_mps==0
    assert 'test-private-key' not in o.model_dump_json()

@pytest.mark.asyncio
async def test_flyitaly_denial_is_sanitized_and_pauses_source():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(403,text='test-private-key'))) as client:
        with pytest.raises(provider.ProviderError) as error:
            await provider.FlyItalyProvider(client,'test-private-key').fetch()
    assert error.value.pause and str(error.value)=='403'

def test_flyitaly_config_needs_explicit_enable_and_key_and_hides_key(monkeypatch):
    monkeypatch.delenv('FLYITALYADSB_API_KEY',raising=False)
    monkeypatch.setenv('FLYITALYADSB_ENABLED','true')
    assert not Settings.from_env().flyitaly_enabled
    monkeypatch.setenv('FLYITALYADSB_API_KEY','test-private-key')
    settings=Settings.from_env()
    assert settings.flyitaly_enabled
    assert 'test-private-key' not in repr(settings)
    monkeypatch.setenv('FLYITALYADSB_ENABLED','false')
    assert not Settings.from_env().flyitaly_enabled

import pytest
from backend.app.config import Settings

@pytest.mark.parametrize('enabled,personal,expected', [('true','true',True),('true','false',False),('false','true',False),('true','',False)])
def test_live_requires_personal_use_acknowledgement(monkeypatch,enabled,personal,expected):
    monkeypatch.setenv('LIVE_ENABLED',enabled)
    monkeypatch.setenv('ADSBFI_PERSONAL_USE',personal)
    monkeypatch.setenv('AIRPLANES_ACCESS_VERIFIED','true')
    monkeypatch.setenv('POLL_SECONDS','0.1')
    settings=Settings.from_env()
    assert settings.live_enabled is expected
    assert settings.poll_seconds == 10

def test_opensky_requires_explicit_activation_permission_and_credentials(monkeypatch):
    monkeypatch.setenv('OPENSKY_CLIENT_ID','test-id')
    monkeypatch.setenv('OPENSKY_CLIENT_SECRET','test-secret')
    monkeypatch.setenv('OPENSKY_ENABLED','true')
    monkeypatch.delenv('OPENSKY_USE_CONFIRMED',raising=False)
    assert Settings.from_env().opensky_enabled is False
    monkeypatch.setenv('OPENSKY_USE_CONFIRMED','true')
    settings=Settings.from_env()
    assert settings.opensky_enabled is True
    assert 'test-secret' not in repr(settings)
    monkeypatch.delenv('OPENSKY_CLIENT_SECRET')
    assert Settings.from_env().opensky_enabled is False

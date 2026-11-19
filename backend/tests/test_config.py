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

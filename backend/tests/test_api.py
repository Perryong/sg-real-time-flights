from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.config import Settings

def test_process_health_is_separate_from_live_availability():
    with TestClient(create_app(Settings())) as c:
        assert c.get('/api/health').json()['ok'] is True
        assert c.get('/api/status').json()['upstream_state']=='unavailable'
        snap=c.get('/api/aircraft').json()
        assert snap['tracks']==[] and snap['mode']=='live'
        assert c.get('/api/airport').status_code==200
        assert c.get('/api/fixtures/../../.env').status_code!=200
        r=c.get('/api/aircraft',headers={'Origin':'https://evil.example'})
        assert r.headers.get('access-control-allow-origin') is None

def test_socket_origin_and_full_snapshot():
    from starlette.websockets import WebSocketDisconnect
    import pytest
    with TestClient(create_app(Settings())) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect('/ws/aircraft',headers={'Origin':'https://evil.example'}): pass
        with c.websocket_connect('/ws/aircraft',headers={'Origin':'http://localhost:5177'}) as ws:
            s=ws.receive_json(); assert s['type']=='snapshot' and s['tracks']==[]

def test_recorded_fixture_is_explicit_synthetic_test_data_with_original_times():
    with TestClient(create_app(Settings())) as c:
        r=c.get('/api/fixtures/recorded-test')
        assert r.status_code==200
        f=r.json(); assert 'Synthetic' in f['provenance']
        assert f['frames'][0]['mode']=='recorded'
        assert f['frames'][0]['tracks'][0]['id'].startswith('recorded:fixture:')
        assert f['frames'][0]['tracks'][0]['latest']['position_time']==1700000000

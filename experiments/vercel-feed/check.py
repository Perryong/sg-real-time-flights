"""Local smoke check with synthetic providers; makes no external requests."""
import importlib.util
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from backend.app.normalize import normalize_record
from backend.app.provider import AdsbFiProvider, FlyItalyProvider, ProviderResult

spec = importlib.util.spec_from_file_location('spike', Path(__file__).with_name('app.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

async def fake(self):
    now = time.time()
    observation = normalize_record({'hex': 'abc123', 'lat': 1.35, 'lon': 104,
        'seen_pos': 0, 'alt_baro': 1000}, now, now, 'live', True)
    return ProviderResult([observation], 0)

AdsbFiProvider.fetch = fake
FlyItalyProvider.fetch = fake
with TestClient(module.app) as client:
    assert client.get('/api/health').json()['test_only'] is True
    frame = client.get('/api/aircraft').json()
    assert len(frame['tracks']) == 1 and frame['status']['movements'] is None
    try:
        with client.websocket_connect('/ws/aircraft', headers={'origin': 'https://untrusted.example'}):
            pass
    except WebSocketDisconnect as error:
        assert error.code == 1008
    else:
        raise AssertionError('Untrusted origin accepted')
    with client.websocket_connect('/ws/aircraft', headers={'origin': 'https://perryong.github.io'}) as ws:
        assert ws.receive_json()['tracks'][0]['id'] == 'live:icao24:abc123'
print('Passed health, normalization, missing daily counts, origin rejection, and WebSocket checks.')

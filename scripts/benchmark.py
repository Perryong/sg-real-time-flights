"""Measure shared 10-viewer ASGI delivery using synthetic observations; never polls upstream."""
import argparse,contextlib,json,time,statistics
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.config import Settings
from backend.app.provider import ProviderResult
from backend.app.normalize import normalize_record

p=argparse.ArgumentParser();p.add_argument('--clients',type=int,default=10);p.add_argument('--duration',type=int,default=300);args=p.parse_args()
class Provider:
    calls=0
    async def fetch(self):
        self.calls+=1; now=time.time()
        return ProviderResult([normalize_record({'hex':f'bench{i}','lat':1.3+i*.0001,'lon':103.99,'alt_baro':5000,'gs':200,'track':23,'seen_pos':0,'type':'synthetic-benchmark'},now,now,'live',True) for i in range(100)],0)
provider=Provider();app=create_app(Settings(),provider);latencies=[];started=time.monotonic();polls=0
with TestClient(app) as client,contextlib.ExitStack() as stack:
    sockets=[stack.enter_context(client.websocket_connect('/ws/aircraft',headers={'Origin':'http://localhost:5177'})) for _ in range(args.clients)]
    for ws in sockets:assert ws.receive_json()['type']=='snapshot'
    while time.monotonic()-started<args.duration:
        received=time.perf_counter();client.portal.call(app.state.feed.poll_once);polls+=1
        for ws in sockets:
            result=ws.receive_json()
            while result['type']=='heartbeat':result=ws.receive_json()
            assert len(result['tracks'])==100
            latencies.append(time.perf_counter()-received)
        time.sleep(max(0,5-(time.perf_counter()-received)))
    assert provider.calls==polls
ordered=sorted(latencies);report={'clients':args.clients,'aircraft':100,'wall_seconds':round(time.monotonic()-started,2),'shared_provider_polls':polls,'p95_receipt_to_asgi_client_seconds':ordered[int((len(ordered)-1)*.95)],'max_seconds':max(ordered),'transport':'in-process ASGI TestClient, includes JSON serialization; not a network deployment benchmark','upstream_requests':0}
Path('docs/evidence/capacity.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
assert report['p95_receipt_to_asgi_client_seconds']<=2

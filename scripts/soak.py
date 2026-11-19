"""Bounded store/inference soak. Default real-time; --accelerated reports scenario time separately."""
import argparse,json,time,gc,statistics
from pathlib import Path
import psutil
from backend.app.normalize import normalize_record
from backend.app.store import TrackStore
from backend.app.inference import infer_phase
from backend.app.main import load_airport

p=argparse.ArgumentParser();p.add_argument('--duration',type=int,default=7200);p.add_argument('--accelerated',action='store_true');p.add_argument('--count',type=int,default=100);a=p.parse_args()
store=TrackStore();runways=load_airport()['runways']['features'];process=psutil.Process();memory=[];started=time.monotonic();peak=0
for step in range(0,a.duration+1,5):
 now=1700000000+step
 # Sixty-second feed outages every ten minutes and bounded identity churn.
 observations=[]
 if step%600<540:
  for i in range(a.count):
   ident=f'bench{i:04x}-{step//1800}'
   observations.append(normalize_record({'hex':ident,'lat':1.2+i*.001,'lon':103.9+(step%300)*.00001,'alt_baro':5000,'gs':200,'track':23,'baro_rate':0,'seen_pos':0},now,now,'simulated',True))
 store.ingest(observations,now)
 for t in store.tracks.values():t.phase=infer_phase(t.history,runways,now,t.phase)
 assert len(store.tracks)<=1000
 assert all(len(t.history)<=301 for t in store.tracks.values())
 peak=max(peak,len(store.tracks))
 if step%60==0:
  gc.collect();memory.append({'scenario_second':step,'rss_bytes':process.memory_info().rss})
 if not a.accelerated:
  remaining=started+step+5-time.monotonic()
  if remaining>0:time.sleep(remaining)
last=[m['rss_bytes'] for m in memory if m['scenario_second']>=max(600,a.duration-3600)]
ratio=max(last)/min(last) if last else None
report={'scenario_seconds':a.duration,'wall_seconds':round(time.monotonic()-started,2),'accelerated':a.accelerated,'aircraft':a.count,'peak_identities':peak,'final_hour_memory_ratio':ratio,'memory_target_pass':ratio is not None and ratio<=1.2,'samples':memory,'note':'Accelerated scenario coverage is NOT a two-hour wall-clock browser soak.' if a.accelerated else 'Backend wall-clock soak; browser memory needs separate evidence.'}
Path('docs/evidence/soak.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='samples'},indent=2))
assert report['memory_target_pass']

"""Deterministic synthetic observations through the production pipeline."""
import argparse,json,math
from pathlib import Path
from geographiclib.geodesic import Geodesic
from backend.app.main import load_airport
from backend.app.normalize import normalize_record
from backend.app.store import TrackStore
from backend.app.inference import infer_phase
from backend.app.contracts import Snapshot,FeedStatus

EPOCH=1700000000

def build_fixture(duration=180,count=16):
    runways=load_airport()['runways']['features']; store=TrackStore(history_seconds=60);frames=[]
    for t in range(0,duration+1,5):
        observations=[]
        for i in range(count):
            runway=runways[i%3]['properties']; threshold=runway['thresholds'][0]; lon,lat=threshold['coordinate']
            group=i%4
            if group==0:
                heading=threshold['bearing']; along=-21000+(i//4)*4000+t*90; cross=0; altitude=max(900,-along*.045); rate=-600
            elif group==1:
                heading=threshold['bearing']; along=5000+(i//4)*5000+t*110;cross=100;altitude=1600+(i//4)*800+t*5;rate=1000
            elif group==2:
                heading=65; along=-26000+(i//4)*9000+t*100;cross=-20000+(i//4)*5500;altitude=6000+i*250;rate=0
            else:
                heading=240;along=-24000+(i//4)*11000+t*95;cross=12000+(i//4)*3000;altitude=7000+i*100;rate=0
            p=Geodesic.WGS84.Direct(lat,lon,heading,along)
            p=Geodesic.WGS84.Direct(p['lat2'],p['lon2'],heading+90,cross)
            raw={'hex':f'demo{i:03}','flight':f'SYN {101+i}','r':f'DEMO-{i+1:02}','t':['A359','B789','A320','B77W'][i%4],'lat':p['lat2'],'lon':p['lon2'],'alt_geom':altitude/.3048,'alt_baro':altitude/.3048,'gs':(90 if group==0 else 110)/(.514444444444),'track':heading,'baro_rate':rate,'seen_pos':0,'type':'synthetic'}
            observations.append(normalize_record(raw,EPOCH+t,EPOCH+t,'simulated',True))
        store.ingest(observations,EPOCH+t)
        for track in store.tracks.values():track.phase=infer_phase(track.history,runways,EPOCH+t,track.phase)
        frame=Snapshot(epoch='synthetic-changi-v1',sequence=t//5,mode='simulated',server_time=EPOCH+t,scenario_time=EPOCH+t,
            status=FeedStatus(mode='simulated',upstream_state='demo',error_code=None,message='Synthetic test scenario; no real flights',last_success=None,newest_position_time=EPOCH+t,geometry_edition='Provisional open geometry'),tracks=store.snapshot(EPOCH+t))
        frames.append(frame.model_dump(mode='json'))
    return {'provenance':'Synthetic test scenario; no real flights','epoch':EPOCH,'duration':duration,'interval':5,'frames':frames}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
    path=Path('tests/fixtures/scenarios/changi-demo.json'); data=json.dumps(build_fixture(),separators=(',',':'))+'\n'
    if args.check:
        assert path.read_text()==data,'Fixture must be regenerated'
        print('Fixture is deterministic and current')
    else:path.write_text(data);print('Generated',len(data),'bytes')

import pytest
from geographiclib.geodesic import Geodesic
from backend.app.main import load_airport
from backend.app.normalize import normalize_record
from backend.app.contracts import PhaseEstimate
from backend.app.inference import infer_phase

RUNWAYS=load_airport()['runways']['features']
EPOCH=1700000000

def series(direction=0,ground=False,rate=-800,speeds=None,along=-5000,cross=0):
    threshold=RUNWAYS[0]['properties']['thresholds'][direction]; lon,lat=threshold['coordinate']; heading=threshold['bearing']
    out=[]
    for i in range(5):
        pt=Geodesic.WGS84.Direct(lat,lon,heading,along+i*400)
        pt=Geodesic.WGS84.Direct(pt['lat2'],pt['lon2'],heading+90,cross)
        raw=dict(hex='abc',lat=pt['lat2'],lon=pt['lon2'],gs=(speeds or [140]*5)[i],track=heading,alt_baro='ground' if ground else 2000-i*200,baro_rate=rate,seen_pos=0)
        out.append(normalize_record(raw,EPOCH+i*5,EPOCH+i*5,'simulated',True))
    return out

@pytest.mark.parametrize('direction',[0,1])
def test_both_approach_directions_require_repeated_evidence(direction):
    h=series(direction)
    assert infer_phase(h[:2],RUNWAYS,EPOCH+5).phase=='unknown'
    p=infer_phase(h,RUNWAYS,EPOCH+20)
    assert p.phase=='final_approach_candidate'
    assert p.candidate_runways==[RUNWAYS[0]['properties']['thresholds'][direction]['id']]
    assert p.reasons and p.confidence!='high'

def test_missing_touchdown_remains_approach_and_overflight_not_landing():
    h=series(); p=infer_phase(h,RUNWAYS,EPOCH+20,PhaseEstimate(phase='final_approach_candidate'))
    assert 'landing' not in p.phase
    assert infer_phase(series(rate=0,cross=5000),RUNWAYS,EPOCH+20).phase=='airborne'

def test_stale_unknown_time_duplicates_and_gap_cannot_advance():
    h=series()
    assert infer_phase(h,RUNWAYS,EPOCH+41).phase=='unknown'
    assert infer_phase([h[0]]*5,RUNWAYS,EPOCH).phase=='unknown'
    h[-1].position_time=None
    assert infer_phase(h,RUNWAYS,EPOCH+20).phase=='unknown'
    h=series();h[-1].position_time=EPOCH+60
    assert infer_phase(h,RUNWAYS,EPOCH+60).phase=='unknown'

def test_unknown_ground_or_heading_does_not_create_taxi_or_runway_event():
    h=series(ground=True,rate=0,speeds=[10]*5,along=1000)
    for o in h:o.ground=None;o.track_deg=None;o.alt_baro_m=None
    assert infer_phase(h,RUNWAYS,EPOCH+20).phase=='unknown'

def test_ground_taxi_and_acceleration():
    h=series(ground=True,rate=0,speeds=[10]*5,along=1000,cross=800)
    assert infer_phase(h,RUNWAYS,EPOCH+20).phase=='taxi_candidate'
    h=series(ground=True,rate=0,speeds=[20,40,60,80,100],along=100)
    assert infer_phase(h,RUNWAYS,EPOCH+20).phase=='takeoff_roll_candidate'

def test_go_around_requires_prior_approach_and_climb():
    h=series(rate=1200)
    assert infer_phase(h,RUNWAYS,EPOCH+20).phase=='climbing_departure_candidate'
    p=infer_phase(h,RUNWAYS,EPOCH+20,PhaseEstimate(phase='final_approach_candidate'))
    assert p.phase=='go_around_candidate'

def test_landing_candidate_needs_air_ground_transition_and_deceleration():
    h=series(ground=True,rate=0,speeds=[120,110,90,70,50],along=100)
    h[0].ground=False;h[1].ground=False
    p=infer_phase(h,RUNWAYS,EPOCH+20,PhaseEstimate(phase='final_approach_candidate'))
    assert p.phase=='landing_candidate'
    assert len(p.evidence_times)>=2

def test_parallel_ambiguity_is_retained():
    import copy
    rs=copy.deepcopy(RUNWAYS[:1]); other=copy.deepcopy(rs[0]); other['properties']['thresholds'][0]['id']='AMBIGUOUS';rs.append(other)
    p=infer_phase(series(),rs,EPOCH+20)
    assert len(p.candidate_runways)==2 and p.confidence=='low'

@pytest.mark.parametrize('transition,expected', [('landing','landing_candidate'),('go_around','go_around_candidate')])
def test_sequential_transition_preserves_established_approach(transition,expected):
    from backend.app.store import TrackStore
    store=TrackStore(); phases=[]
    h=series(along=-2000 if transition=='landing' else -5000)
    tail=series(ground=transition=='landing',rate=0 if transition=='landing' else 1200,
                speeds=[120,100,80,60,40] if transition=='landing' else None,
                along=0 if transition=='landing' else -3000)
    for i,o in enumerate(tail):
        o.position_time=EPOCH+25+i*5;o.receipt_time=o.position_time
    for o in h+tail:
        store.ingest([o],o.position_time)
        t=next(iter(store.tracks.values()))
        t.phase=infer_phase(t.history,RUNWAYS,o.position_time,t.phase)
        phases.append(t.phase.phase)
    assert 'final_approach_candidate' in phases
    assert expected in phases
    # A discontinuity must discard the earlier approach context.
    gap=tail[-1].model_copy(update={'position_time':EPOCH+100,'receipt_time':EPOCH+100})
    store.ingest([gap],EPOCH+100);t=next(iter(store.tracks.values()))
    assert infer_phase(t.history,RUNWAYS,EPOCH+100,t.phase).phase=='unknown'

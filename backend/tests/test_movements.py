from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from backend.app.movements import MovementLedger
from backend.app.main import load_airport
from backend.app.contracts import Observation, Track
from geographiclib.geodesic import Geodesic

RUNWAYS = load_airport()['runways']['features']
NOW = datetime(2026,11,20,12,tzinfo=ZoneInfo('Asia/Singapore')).timestamp()

def track(kind='landing', start=NOW, cross=0):
    threshold=RUNWAYS[0]['properties']['thresholds'][0]
    lon,lat=threshold['coordinate']; heading=threshold['bearing']
    history=[]
    for i in range(4):
        p=Geodesic.WGS84.Direct(lat,lon,heading,300+i*350)
        p=Geodesic.WGS84.Direct(p['lat2'],p['lon2'],heading+90,cross)
        ground=i>=2 if kind=='landing' else i<2
        history.append(Observation(id='live:icao24:abc123',provider_id='abc123',provider='adsb.fi',session_id='one',mode='live',
            lat=p['lat2'],lon=p['lon2'],ground=ground,speed_mps=80-i*10 if kind=='landing' else 40+i*10,
            track_deg=heading,vertical_rate_mps=-3 if kind=='landing' else 3,
            position_time=start+i*10,receipt_time=start+i*10))
    return Track(id=history[0].id,session_id='one',latest=history[-1],history=history)

@pytest.mark.parametrize('kind', ['landing','takeoff'])
def test_detected_event_persists_and_repeated_history_counts_once(tmp_path,kind):
    path=tmp_path/'counts.sqlite3'; ledger=MovementLedger(path,RUNWAYS)
    t=track(kind)
    ledger.record([t],NOW+30,NOW+30)
    ledger.record([t],NOW+40,NOW+40)
    summary=ledger.summary(NOW+40)
    assert getattr(summary,kind+'s')==1
    ledger.close()
    ledger=MovementLedger(path,RUNWAYS)
    ledger.record([t],NOW+45,NOW+45)
    assert getattr(ledger.summary(NOW+45),kind+'s')==1
    ledger.close()

@pytest.mark.parametrize('case', ['overflight','taxi','unknown','gap','stale','future','source','session','demo','elsewhere','no_climb','one_ground'])
def test_uncertain_tracks_never_count(case):
    ledger=MovementLedger(':memory:',RUNWAYS);t=track('takeoff')
    if case=='overflight':
        for o in t.history:o.ground=False
    if case=='taxi':
        for o in t.history:o.ground=True
    if case=='unknown':t.history[1].ground=None
    if case=='gap':t.history[0].position_time-=30
    if case=='stale':
        for o in t.history:o.position_time-=60
    if case=='future':t.history[-1].position_time+=60
    if case=='source':t.history[0].provider='opensky'
    if case=='session':t.history[0].session_id='old'
    if case=='demo':
        for o in t.history:o.mode='simulated'
    if case=='elsewhere':t=track('takeoff',cross=4000)
    if case=='no_climb':t.history[-1].vertical_rate_mps=0
    if case=='one_ground':t.history[0].ground=False
    ledger.record([t],NOW+30,NOW+30)
    summary=ledger.summary(NOW+30)
    assert summary.landings==summary.takeoffs==0
    ledger.close()

def test_coverage_records_only_new_successes_and_excludes_downtime(tmp_path):
    path=tmp_path/'counts.sqlite3';ledger=MovementLedger(path,RUNWAYS)
    ledger.record([],NOW,NOW)
    ledger.record([],NOW+10,NOW+10)
    ledger.record([],NOW+10,NOW+20)  # cached response
    assert ledger.summary(NOW+20).observed_seconds==10
    ledger.close();ledger=MovementLedger(path,RUNWAYS)
    ledger.record([],NOW+600,NOW+600)
    s=ledger.summary(NOW+600)
    assert s.observed_seconds==10
    assert s.first_observed_at==NOW
    assert s.unmonitored_seconds>=12*3600
    ledger.close()

def test_singapore_midnight_splits_coverage_and_counts():
    midnight=datetime(2026,11,21,tzinfo=ZoneInfo('Asia/Singapore')).timestamp()
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([track(start=midnight-35)],midnight-5,midnight-5)
    assert ledger.summary(midnight-5).landings==1
    ledger.record([],midnight+5,midnight+5)
    s=ledger.summary(midnight+5)
    assert s.day=='2026-11-21' and s.landings==0 and s.observed_seconds==5
    ledger.close()

def test_storage_failure_is_unavailable_not_zero(tmp_path):
    ledger=MovementLedger(tmp_path,RUNWAYS)  # directory is not a database
    ledger.record([track()],NOW+30,NOW+30)
    assert ledger.summary(NOW+30).available is False
    ledger.close()

@pytest.mark.asyncio
async def test_collector_publishes_counts_without_counting_cached_observations(tmp_path):
    from backend.app.service import FeedService
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult
    now=[NOW]; samples=iter(track().history)
    class Provider:
        async def fetch(self):
            self.latest=next(samples,getattr(self,'latest',None))
            return ProviderResult([self.latest],0)
    feed=FeedService(Settings(movement_db=str(tmp_path/'events.sqlite3')),Provider(),lambda:now[0])
    for _ in range(4):
        await feed.poll_once();now[0]+=10
    assert feed.snapshot().status.movements.landings==1
    await feed.poll_once()
    assert feed.snapshot().model_dump()['status']['movements']['landings']==1
    feed.movements.close()

def test_later_flight_counts_but_state_bounce_does_not():
    ledger=MovementLedger(':memory:',RUNWAYS)
    for offset in (0,40,3600):
        ledger.record([track(start=NOW+offset)],NOW+offset+30,NOW+offset+30)
    assert ledger.summary(NOW+3630).landings==2
    ledger.close()

def test_missing_deceleration_and_unaligned_ground_are_not_landings():
    ledger=MovementLedger(':memory:',RUNWAYS)
    t=track()
    t.history[-1].speed_mps=90
    ledger.record([t],NOW+30,NOW+30)
    t=track()
    t.history[2].track_deg=None
    ledger.record([t],NOW+30,NOW+30)
    assert ledger.summary(NOW+30).landings==0
    ledger.close()

def test_known_failed_poll_breaks_coverage_even_before_short_retry():
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([],NOW,NOW)
    ledger.record([],None,NOW+10)
    ledger.record([],NOW+20,NOW+20)
    assert ledger.summary(NOW+20).observed_seconds==0
    ledger.close()

@pytest.mark.asyncio
async def test_failed_collector_poll_preserves_gap_in_coverage():
    from backend.app.service import FeedService
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult,ProviderError
    now=[NOW]
    class Provider:
        async def fetch(self):
            if now[0]==NOW+10:raise ProviderError('timeout')
            return ProviderResult([],0)
    feed=FeedService(Settings(),Provider(),lambda:now[0])
    for offset in (0,10,20):
        now[0]=NOW+offset;await feed.poll_once()
    assert feed.status().movements.observed_seconds==0
    feed.movements.close()

@pytest.mark.asyncio
async def test_cached_combined_response_does_not_bridge_failed_attempt():
    from backend.app.service import FeedService
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult
    from backend.app.contracts import SourceStatus
    now=[NOW]
    class Provider:
        async def fetch(self):return ProviderResult([],0)
        def statuses(self):
            failed=now[0]==NOW+10
            success=NOW if failed else now[0]
            return {'adsb.fi':SourceStatus(enabled=True,state='degraded' if failed else 'healthy',
                last_attempt=now[0],last_success=success,error_code='timeout' if failed else None)}
    feed=FeedService(Settings(),Provider(),lambda:now[0])
    for offset in (0,10,20):
        now[0]=NOW+offset;await feed.poll_once()
    assert feed.status().movements.observed_seconds==0
    feed.movements.close()

def test_old_success_cannot_restart_coverage_after_failure():
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([],NOW,NOW)
    ledger.record([],None,NOW+10)
    ledger.record([],NOW,NOW+15)
    ledger.record([],NOW+20,NOW+20)
    assert ledger.summary(NOW+20).observed_seconds==0
    ledger.close()


def test_exported_ledger_restores_counts_and_only_contiguous_coverage():
    import json
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([track()],NOW+30,NOW+30)
    saved=json.loads(json.dumps(ledger.export_state()))
    ledger.close()
    restored=MovementLedger(':memory:',RUNWAYS)
    restored.restore_state(saved)
    restored.record([track()],NOW+45,NOW+45)
    s=restored.summary(NOW+45)
    assert s.landings==1 and s.observed_seconds==15
    restored.record([],NOW+600,NOW+600)
    assert restored.summary(NOW+600).observed_seconds==15
    restored.record([],None,NOW+610)
    saved=restored.export_state();restored.close()
    resumed=MovementLedger(':memory:',RUNWAYS);resumed.restore_state(saved)
    resumed.record([],NOW+620,NOW+620)
    assert resumed.summary(NOW+620).observed_seconds==15
    resumed.close()


def test_export_retains_seven_singapore_days_and_rolls_midnight():
    ledger=MovementLedger(':memory:',RUNWAYS)
    for day in range(9):
        stamp=NOW+day*86400
        ledger.record([track(start=stamp)],stamp+30,stamp+30)
    saved=ledger.export_state();ledger.close()
    restored=MovementLedger(':memory:',RUNWAYS);restored.restore_state(saved)
    assert restored.summary(NOW).landings==0
    assert restored.summary(NOW+2*86400).landings==1
    assert restored.summary(NOW+8*86400).landings==1
    assert restored.summary(NOW+9*86400).landings==0
    restored.close()


@pytest.mark.parametrize('saved', [None, {}, {'events':[['x','landing','bad','2026-11-20']]},
    {'events':[], 'coverage':[['2026-11-20',NOW,NOW,float('nan')]],'last_success_seen':None,'previous_success':None}])
def test_invalid_saved_ledger_is_rejected_without_replacing_counts(saved):
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([track()],NOW+30,NOW+30)
    with pytest.raises(ValueError): ledger.restore_state(saved)
    assert ledger.summary(NOW+30).landings==1
    ledger.close()


def test_out_of_range_saved_timestamp_is_a_validation_error():
    ledger=MovementLedger(':memory:',RUNWAYS)
    ledger.record([track()],NOW+30,NOW+30)
    saved=ledger.export_state();saved['events'][0][2]=1e20
    with pytest.raises(ValueError):ledger.restore_state(saved)
    assert ledger.summary(NOW+30).landings==1
    ledger.close()

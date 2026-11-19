from backend.app.normalize import normalize_record
from backend.app.store import TrackStore

def obs(t=1700000000, ident='abc123', **kw):
    return normalize_record(dict(hex=ident, lat=1.35, lon=104, seen_pos=0, **kw),t,t,'live',True)

def test_duplicate_late_and_cached_records_do_not_renew_positions():
    s=TrackStore(); s.ingest([obs()],1700000000)
    s.ingest([obs(),obs(1699999990)],1700000010)
    t=s.snapshot(1700000010)[0]
    assert t.latest.position_time==1700000000
    assert len(t.history)==1
    assert s.snapshot(1700000121)==[]

def test_history_capacity_and_jump_are_bounded():
    s=TrackStore(capacity=2)
    for i in range(70): s.ingest([obs(1700000000+i*5)],1700000000+i*5)
    assert len(s.snapshot(1700000345)[0].history)<=61
    s.ingest([obs(1700000345, 'b'),obs(1700000345,'c')],1700000345)
    assert len(s.snapshot(1700000345))==2
    assert s.evictions==1
    o=obs(1700000350,'c'); o.lat=80
    s.ingest([o],1700000350)
    assert len(next(t for t in s.snapshot(1700000350) if t.latest.provider_id=='c').history)==1

def test_unknown_time_expires_by_receipt_without_claiming_freshness():
    s=TrackStore(); o=obs(); o.position_time=None
    s.ingest([o],1700000000)
    assert s.snapshot(1700000001)[0].latest.position_time is None
    assert s.snapshot(1700000121)==[]

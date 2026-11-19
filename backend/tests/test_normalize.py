import math
import pytest
from backend.app.normalize import normalize_record

NOW = 1_700_000_000.0

def record(**kw):
    return dict(hex='abc123', lat=1.35, lon=104.0, **kw)

def normalize(raw, verified=True):
    return normalize_record(raw, NOW, NOW + 1, 'live', verified)

def test_units_and_zero_values_survive():
    o = normalize(record(alt_baro=1000, alt_geom=1100, gs=60, track=0, baro_rate=1000, seen_pos=2))
    assert o.alt_baro_m == 304.8
    assert o.speed_mps == pytest.approx(30.8666666667)
    assert o.vertical_rate_mps == 5.08
    assert o.track_deg == 0
    assert o.position_time == NOW - 2
    assert normalize(record(gs=0)).speed_mps == 0

def test_ground_does_not_invent_altitude():
    o = normalize(record(alt_baro='ground', flight='   '))
    assert o.ground is True
    assert o.alt_baro_m is None
    assert o.callsign is None
    assert o.raw['alt_baro'] == 'ground'

@pytest.mark.parametrize('kw', [{'lat':91}, {'lon':181}, {'lat':math.nan}, {'lat':'1.3'}, {'hex':''}])
def test_reject_invalid_position_or_identity(kw):
    raw = record()
    raw.update(kw)
    assert normalize(raw) is None

@pytest.mark.parametrize('kw', [{}, {'seen_pos':-1}, {'seen_pos':math.inf}, {'seen_pos':'1'}])
def test_unknown_time_never_becomes_receipt_time(kw):
    o = normalize(record(**kw))
    assert o.position_time is None
    assert o.timestamp_quality == 'unknown'
    assert o.receipt_time == NOW + 1

def test_unverified_semantics_prohibit_observed_time():
    assert normalize(record(seen_pos=0), False).position_time is None

def test_non_icao_identity_and_no_invented_ground_flag():
    raw = record()
    raw['hex'] = '~abc123'
    o = normalize(raw)
    assert o.provider_id == '~abc123'
    assert o.ground is None
    assert o.alt_geom_m is None

def test_future_provider_time_rejected():
    assert normalize_record(record(seen_pos=0), NOW + 60, NOW, 'live', True).position_time is None

from copy import deepcopy
from scripts.build_fixtures import build_fixture, comparable_fixture

def test_fixture_namespace_original_time_and_no_future_leakage():
    f=build_fixture(duration=20,count=4)
    assert f['provenance']=='Synthetic test scenario; no real flights'
    assert len(f['frames'])==5
    for frame in f['frames']:
        assert frame['mode']=='simulated' and frame['scenario_time']<1800000000
        for track in frame['tracks']:
            assert track['id'].startswith('simulated:fixture:')
            assert all(p['position_time']<=frame['scenario_time'] for p in track['history'])
    assert build_fixture(duration=20,count=4)==f


def test_fixture_check_accepts_legacy_defaults_but_detects_position_and_time_drift():
    original = build_fixture(duration=0, count=1)
    expected = comparable_fixture(original)
    saved = deepcopy(original)
    latest = saved['frames'][0]['tracks'][0]['latest']
    del latest['route']
    del saved['frames'][0]['status']['collection_mode']
    latest['lat'] += 1e-14
    assert comparable_fixture(saved) == expected

    latest['position_time'] -= 1
    assert comparable_fixture(saved) != expected
    latest['position_time'] += 1
    latest['lat'] += 1e-6
    assert comparable_fixture(saved) != expected

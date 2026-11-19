from scripts.build_fixtures import build_fixture

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

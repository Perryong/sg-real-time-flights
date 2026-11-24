"""Fixed regional model and wide observed radar contracts."""
from copy import deepcopy
import math

import pytest

from backend.app import weather
from backend.tests.test_weather import NOW, radar_payload


def model_payload():
    return [{'latitude': point['lat'], 'longitude': point['lon'], 'utc_offset_seconds': 0,
             'current_units': {'time': 'unixtime', 'interval': 'seconds', 'wind_speed_10m': 'm/s', 'wind_direction_10m': '°'},
             'current': {'time': NOW - 60, 'interval': 900, 'wind_speed_10m': 4.5, 'wind_direction_10m': 360}}
            for point in weather.REGIONAL_GRID]


def wide_payload():
    payload = radar_payload()
    payload['data']['boundaryBox'].update(upperLeft={'longitude': 99.638609, 'latitude': 5.657912},
                                        lowerRight={'longitude': 108.290871, 'latitude': -2.967382})
    payload['data']['records'][0]['image']['range'] = '480km'
    return payload


def distance(lat, lon, other_lat=1.3644, other_lon=103.9915):
    a, b = math.radians(lat), math.radians(other_lat)
    dlon = math.radians(lon - other_lon)
    return 6371 * math.acos(min(1, max(-1, math.sin(a)*math.sin(b)+math.cos(a)*math.cos(b)*math.cos(dlon))))


def test_grid_covers_fixed_500km_circle_with_49_unique_points():
    grid = getattr(weather, 'REGIONAL_GRID', [])
    assert len(grid) == 49
    assert len({p['id'] for p in grid}) == 49
    distances = [distance(p['lat'], p['lon']) for p in grid]
    assert min(distances) < .001
    assert max(distances) == pytest.approx(500, abs=.001)
    assert sum(d < 125.001 for d in distances) == 5
    assert min(p['lon'] for p in grid) < 100 and max(p['lon'] for p in grid) > 108


def test_regional_retains_actual_model_coordinates_and_explicit_metadata():
    payload = model_payload()
    center = next(i for i, p in enumerate(payload) if distance(p['latitude'], p['longitude']) < .001)
    payload[center]['latitude'] += .01
    result = weather.normalize_regional_wind(payload, NOW)
    assert result['kind'] == 'model' and result['source'] == 'Open-Meteo'
    assert result['height_m'] == 10 and result['coverage_km'] == 500
    assert result['observed_at'] == NOW - 60 and result['retry_after'] == 900
    assert len(result['points']) == 49
    assert result['points'][center]['lat'] == payload[center]['latitude']
    assert result['points'][center]['speed_mps'] == 4.5 and result['points'][center]['from_deg'] == 0
    assert 'stations' not in result and 'radar' not in result


@pytest.mark.parametrize('damage', ['speed', 'direction', 'units', 'time', 'timezone', 'coordinates', 'region', 'interval', 'missing'])
def test_invalid_model_points_are_absent_instead_of_fabricated(damage):
    payload = model_payload()
    center = next(i for i, p in enumerate(payload) if distance(p['latitude'], p['longitude']) < .001)
    point = payload[center]
    if damage == 'speed': point['current']['wind_speed_10m'] = None
    if damage == 'direction': point['current']['wind_direction_10m'] = float('nan')
    if damage == 'units': point['current_units']['wind_speed_10m'] = 'km/h'
    if damage == 'time': point['current']['time'] = NOW + 1000
    if damage == 'timezone': point['utc_offset_seconds'] = 28800
    if damage == 'coordinates': point['longitude'] += 1
    if damage == 'region':
        center = 0
        payload[0]['latitude'] -= .2
    if damage == 'interval': point['current']['interval'] = 3600
    if damage == 'missing': payload[center] = None
    result = weather.normalize_regional_wind(payload, NOW)
    assert len(result['points']) == 48
    assert weather.REGIONAL_GRID[center]['id'] not in [p['id'] for p in result['points']]


def test_model_rejects_incomplete_batch_and_no_usable_readings():
    payload = model_payload()
    with pytest.raises(ValueError): weather.normalize_regional_wind(payload[:-1], NOW)
    for p in payload: p['current']['wind_speed_10m'] = None
    with pytest.raises(ValueError): weather.normalize_regional_wind(payload, NOW)


def test_model_valid_time_does_not_mix_points_from_different_times():
    payload = model_payload()
    payload[10]['current']['time'] -= 900
    frame = weather.normalize_regional_wind(payload, NOW)
    assert frame['observed_at'] == NOW - 60 and len(frame['points']) == 48


def test_regional_freshness_and_cache_boundary_validation():
    frame = weather.normalize_regional_wind(model_payload(), NOW)
    assert weather.render(frame, NOW + 1700)['state'] == 'fresh'
    assert weather.render(frame, NOW + 1801)['state'] == 'stale'
    expired = weather.render(frame, NOW + 3601)
    assert expired['state'] == 'unavailable' and expired['points'] == []
    for field, value in [('kind', 'observation'), ('coverage_km', 70), ('height_m', 100), ('source', 'NEA')]:
        damaged = deepcopy(frame); damaged[field] = value
        with pytest.raises(ValueError): weather.render(damaged, NOW)
    frame['points'][0]['lon'] = 0
    with pytest.raises(ValueError): weather.render(frame, NOW)


def test_wide_radar_uses_actual_bounds_and_independent_contract():
    frame = weather.normalize_radar(wide_payload(), NOW, layer='radar_wide')
    assert frame['layer'] == 'radar_wide' and frame['range_km'] == 480
    assert frame['radar']['west'] == 99.638609 and frame['radar']['south'] == -2.967382
    assert frame['radar']['east'] == 108.290871 and frame['radar']['north'] == 5.657912
    assert weather.render(frame, NOW + 901)['radar'] is None
    with pytest.raises(ValueError): weather.normalize_radar(radar_payload(), NOW, layer='radar_wide')
    with pytest.raises(ValueError): weather.normalize_radar(wide_payload(), NOW)
    wrong = wide_payload(); wrong['data']['boundaryBox'] = radar_payload()['data']['boundaryBox']
    with pytest.raises(ValueError): weather.normalize_radar(wrong, NOW, layer='radar_wide')
    frame['range_km'] = 70
    with pytest.raises(ValueError): weather.render(frame, NOW)

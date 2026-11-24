"""Official v2 schemas, with fabricated values and unsigned fixture image URLs."""
from datetime import datetime, timezone

import pytest

NOW = 1795537200.0
STAMP = datetime.fromtimestamp(NOW - 60, timezone.utc).isoformat()
HOST = 'dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com'


def wind_payload(unit='knots', value=10):
    return {'code': 0, 'errorMsg': '', 'data': {
        'stations': [{'id': 'S117', 'deviceId': 'S117', 'name': 'Banyan Road',
                      'location': {'latitude': 1.2542, 'longitude': 103.6741}}],
        'readingType': 'Wind Speed AVG(S)10M M1M', 'readingUnit': unit,
        'readings': [{'timestamp': STAMP, 'data': [{'stationId': 'S117', 'value': value}]}]}}


def radar_payload():
    return {'code': 0, 'errorMsg': '', 'data': {
        'projection': {'type': 'Azimuthal Equidistant', 'center': {'longitude': 103.972583, 'latitude': 1.34911}},
        'boundaryBox': {'crs': 'EPSG:4326', 'upperLeft': {'longitude': 103.342685, 'latitude': 1.97854},
                        'lowerRight': {'longitude': 104.602315, 'latitude': 0.719515}},
        'records': [{'timestamp': STAMP, 'updatedTimestamp': STAMP, 'image': {
            'url': f'https://{HOST}/fixture.png', 'urlExpiresAt': datetime.fromtimestamp(NOW + 900, timezone.utc).isoformat(),
            'label': 'fixture.png', 'range': '70km', 'format': 'png'}}], 'paginationToken': None}}


def test_wind_joins_station_id_and_time_and_converts_knots():
    from backend.app.weather import normalize_wind
    speed, direction = wind_payload(), wind_payload('degrees', 360)
    direction['data']['readings'][0]['data'].insert(0, {'stationId': 'missing', 'value': 90})
    result = normalize_wind(speed, direction, NOW)
    assert result['state'] == 'fresh' and result['observed_at'] == NOW - 60
    assert result['stations'] == [{'id': 'S117', 'name': 'Banyan Road', 'lat': 1.2542,
                                  'lon': 103.6741, 'speed_mps': pytest.approx(5.144444444), 'from_deg': 0}]


@pytest.mark.parametrize('damage', ['unit', 'time', 'future', 'position', 'speed', 'direction', 'missing'])
def test_wind_rejects_unpaired_or_invalid_measurements(damage):
    from backend.app.weather import normalize_wind
    speed, direction = wind_payload(), wind_payload('degrees', 90)
    if damage == 'unit': speed['data']['readingUnit'] = 'mph'
    if damage == 'time': direction['data']['readings'][0]['timestamp'] = '2026-11-24T18:57:00Z'
    if damage == 'future':
        for data in (speed, direction): data['data']['readings'][0]['timestamp'] = '2099-01-01T00:00:00Z'
    if damage == 'position': speed['data']['stations'][0]['location']['latitude'] = 60
    if damage == 'speed': speed['data']['readings'][0]['data'][0]['value'] = float('nan')
    if damage == 'direction': direction['data']['readings'][0]['data'][0]['value'] = -10
    if damage == 'missing': direction['data']['readings'][0]['data'] = []
    with pytest.raises(ValueError): normalize_wind(speed, direction, NOW)


def test_radar_uses_official_geographic_bounds_and_expiration():
    from backend.app.weather import normalize_radar, render
    result = normalize_radar(radar_payload(), NOW)
    assert result['radar'] == {'url': f'https://{HOST}/fixture.png', 'west': 103.342685, 'south': 0.719515,
                               'east': 104.602315, 'north': 1.97854, 'observed_at': NOW - 60, 'expires_at': NOW + 900}
    expired = render(result, NOW + 901)
    assert expired['state'] == 'unavailable' and expired['radar'] is None
    assert expired['observed_at'] == NOW - 60 and expired['fetched_at'] == NOW


@pytest.mark.parametrize('damage', ['url', 'credentials', 'port', 'bounds', 'crs', 'range', 'expired', 'missing_expiry'])
def test_radar_rejects_unsafe_or_unusable_frames(damage):
    from backend.app.weather import normalize_radar
    payload = radar_payload(); image = payload['data']['records'][0]['image']
    if damage == 'url': image['url'] = 'https://evil.example/radar.png'
    if damage == 'credentials': image['url'] = f'https://someone@{HOST}/radar.png'
    if damage == 'port': image['url'] = f'https://{HOST}:1234/radar.png'
    if damage == 'bounds': payload['data']['boundaryBox']['lowerRight']['longitude'] = 100
    if damage == 'crs': payload['data']['boundaryBox']['crs'] = 'EPSG:3857'
    if damage == 'range': image['range'] = '480km'
    if damage == 'expired': image['urlExpiresAt'] = STAMP
    if damage == 'missing_expiry': image.pop('urlExpiresAt')
    with pytest.raises(ValueError): normalize_radar(payload, NOW)


def test_stale_wind_keeps_original_timestamps_and_disappears_when_too_old():
    from backend.app.weather import normalize_wind, render
    original = normalize_wind(wind_payload(), wind_payload('degrees', 90), NOW)
    stale = render(original, NOW + 601)
    assert stale['state'] == 'stale' and stale['stations']
    assert stale['fetched_at'] == NOW and stale['observed_at'] == NOW - 60
    assert render(original, NOW + 1801)['stations'] == []
    assert original['state'] == 'fresh'


@pytest.mark.parametrize('damage', ['url', 'station', 'state', 'timestamp'])
def test_cached_frames_are_validated_before_rendering(damage):
    from backend.app.weather import normalize_radar, normalize_wind, render
    frame = normalize_radar(radar_payload(), NOW) if damage == 'url' else normalize_wind(wind_payload(), wind_payload('degrees', 90), NOW)
    if damage == 'url': frame['radar']['url'] = 'https://evil.example/frame.png'
    if damage == 'station': frame['stations'][0]['lat'] = float('nan')
    if damage == 'state': frame['state'] = 'invented'
    if damage == 'timestamp': frame['fetched_at'] = 'yesterday'
    with pytest.raises(ValueError): render(frame, NOW)


@pytest.mark.parametrize('damage', ['missing_observation', 'missing_fetch', 'empty_stations'])
def test_fresh_cached_weather_requires_observations_and_data(damage):
    from backend.app.weather import normalize_wind, render
    frame = normalize_wind(wind_payload(), wind_payload('degrees', 90), NOW)
    if damage == 'missing_observation': frame['observed_at'] = None
    if damage == 'missing_fetch': frame['fetched_at'] = None
    if damage == 'empty_stations': frame['stations'] = []
    with pytest.raises(ValueError): render(frame, NOW)

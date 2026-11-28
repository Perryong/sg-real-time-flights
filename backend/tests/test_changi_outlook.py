"""Exercise the fixed outlook route with real Redis and a controlled provider."""
import asyncio
import json
import uuid
from datetime import datetime

import httpx
import pytest
import pytest_asyncio

from backend.app import weather
from backend.app.cloud import create_cloud_app
from backend.tests.test_cloud import command, redis_port


NOW = datetime.fromisoformat('2026-11-30T23:55:00+08:00').timestamp()
VALID = datetime.fromisoformat('2026-11-30T23:45:00+08:00').timestamp()
LOCATION = {'name': 'Changi Airport', 'lat': 1.3644, 'lon': 103.9915}
ROUTE = '/api/weather?layer=changi_outlook'


def outlook_payload():
    return {
        'latitude': 1.3708259, 'longitude': 103.94466, 'generationtime_ms': 0.3,
        'utc_offset_seconds': 28800, 'timezone': 'Asia/Singapore', 'timezone_abbreviation': 'GMT+8', 'elevation': 5,
        'current_units': {'time': 'iso8601', 'interval': 'seconds', 'relative_humidity_2m': '%', 'pressure_msl': 'hPa'},
        'current': {'time': '2026-11-30T23:45', 'interval': 900, 'relative_humidity_2m': 0, 'pressure_msl': 1010.4},
        'daily_units': {'time': 'iso8601', 'weather_code': 'wmo code', 'temperature_2m_min': '°C', 'temperature_2m_max': '°C'},
        'daily': {'time': ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'],
                  'weather_code': [2, 0, 3, 97, 81, 95], 'temperature_2m_min': [24, 24, 25, 26, 24, 23],
                  'temperature_2m_max': [29, 30, 31, 32, 30, 29]},
    }


@pytest_asyncio.fixture
async def outlook(command, monkeypatch):
    namespace = 'test:weather:outlook:' + uuid.uuid4().hex
    requests = []
    started, release = asyncio.Event(), asyncio.Event()
    behavior = {'now': NOW, 'payload': outlook_payload(), 'status': 200, 'hold': False}
    cache_class, feed_class, client_class = weather.WeatherCache, weather.WeatherFeed, httpx.AsyncClient

    async def upstream(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requests.append(request)
        if behavior['hold']:
            started.set()
            await release.wait()
        return httpx.Response(behavior['status'], json=behavior['payload'], headers={'Retry-After': '1200'})

    monkeypatch.setattr(weather, 'WeatherCache', lambda *args: cache_class(*args, prefix=namespace))
    monkeypatch.setattr(weather, 'WeatherFeed', lambda *args: feed_class(*args, clock=lambda: behavior['now']))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client_class(transport=httpx.MockTransport(upstream)))
    monkeypatch.setenv('KV_REST_API_URL', 'https://redis.example')
    monkeypatch.setenv('KV_REST_API_TOKEN', 'test-redis-only-secret')
    monkeypatch.setenv('DATAGOV_API_KEY', 'test-nea-only-secret')
    monkeypatch.setenv('VERCEL', '1')
    async with client_class(transport=httpx.ASGITransport(app=create_cloud_app()), base_url='https://app.example') as client:
        yield client, behavior, requests, namespace + ':changi_outlook', started, release


@pytest.mark.asyncio
async def test_outlook_has_fixed_query_location_and_local_dates(outlook):
    client, _, requests, *_ = outlook
    for suffix in ('&latitude=20', '&longitude=10', '&url=https://example.com', '&layer=wind'):
        assert (await client.get(ROUTE + suffix)).status_code == 400
    response = await client.get(ROUTE, headers={'Origin': 'https://perryong.github.io'})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'https://perryong.github.io'
    assert response.json() == {
        'layer': 'changi_outlook', 'source': 'Open-Meteo', 'location': LOCATION,
        'state': 'fresh', 'observed_at': VALID, 'fetched_at': NOW, 'retry_after': 900, 'message': None,
        'current': {'humidity_pct': 0, 'pressure_msl_hpa': 1010.4},
        'daily': [
            {'date': '2026-12-01', 'weather_code': 0, 'low_c': 24, 'high_c': 30},
            {'date': '2026-12-02', 'weather_code': 3, 'low_c': 25, 'high_c': 31},
            {'date': '2026-12-03', 'weather_code': 97, 'low_c': 26, 'high_c': 32},
            {'date': '2026-12-04', 'weather_code': 81, 'low_c': 24, 'high_c': 30},
            {'date': '2026-12-05', 'weather_code': 95, 'low_c': 23, 'high_c': 29},
        ],
    }
    requested, = requests
    assert requested.url.host == 'api.open-meteo.com' and requested.url.path == '/v1/forecast'
    assert dict(requested.url.params) == {
        'latitude': '1.3644', 'longitude': '103.9915', 'timezone': 'Asia/Singapore',
        'current': 'relative_humidity_2m,pressure_msl', 'daily': 'weather_code,temperature_2m_min,temperature_2m_max',
        'forecast_days': '6',
    }
    assert 'x-api-key' not in requested.headers and 'authorization' not in requested.headers


@pytest.mark.asyncio
@pytest.mark.parametrize('pressure_unit', [None, 'Pa'])
async def test_outlook_retains_valid_fields_at_their_date_on_partial_data(outlook, pressure_unit):
    client, behavior, *_ = outlook
    payload = behavior['payload']
    if pressure_unit is None:
        del payload['current']['pressure_msl']
    else:
        payload['current_units']['pressure_msl'] = pressure_unit
    payload['daily']['time'][2] = None
    payload['daily']['weather_code'][3] = 98
    payload['daily']['temperature_2m_min'][3] = 33
    payload['daily']['temperature_2m_max'] = [29, 30, 31, 32, 300]
    response = await client.get(ROUTE)
    assert response.status_code == 200
    assert response.json()['current'] == {'humidity_pct': 0, 'pressure_msl_hpa': None}
    assert response.json()['daily'] == [
        {'date': '2026-12-01', 'weather_code': 0, 'low_c': 24, 'high_c': 30},
        {'date': '2026-12-02', 'weather_code': None, 'low_c': None, 'high_c': None},
        {'date': '2026-12-03', 'weather_code': None, 'low_c': None, 'high_c': None},
        {'date': '2026-12-04', 'weather_code': 81, 'low_c': 24, 'high_c': None},
        {'date': '2026-12-05', 'weather_code': 95, 'low_c': 23, 'high_c': None},
    ]


@pytest.mark.asyncio
async def test_outlook_accepts_forecast_without_a_current_observation(outlook):
    client, behavior, *_ = outlook
    del behavior['payload']['current']
    response = await client.get(ROUTE)
    cached = await client.get(ROUTE)
    assert response.status_code == cached.status_code == 200
    for frame in (response.json(), cached.json()):
        assert frame['state'] == 'fresh' and frame['fetched_at'] == NOW and frame['observed_at'] is None
        assert frame['current'] == {'humidity_pct': None, 'pressure_msl_hpa': None}
        assert frame['daily'][0] == {'date': '2026-12-01', 'weather_code': 0, 'low_c': 24, 'high_c': 30}


@pytest.mark.asyncio
async def test_outlook_reselects_days_when_singapore_crosses_midnight(outlook):
    client, behavior, requests, *_ = outlook
    assert (await client.get(ROUTE)).status_code == 200
    behavior['now'] += 360
    frame = (await client.get(ROUTE)).json()
    assert frame['daily'][0] == {'date': '2026-12-02', 'weather_code': 3, 'low_c': 25, 'high_c': 31}
    assert frame['daily'][-1] == {'date': '2026-12-06', 'weather_code': None, 'low_c': None, 'high_c': None}
    assert frame['fetched_at'] == NOW and len(requests) == 1


@pytest.mark.asyncio
async def test_outlook_expires_current_and_daily_at_their_own_limits(outlook):
    client, behavior, *_ = outlook
    assert (await client.get(ROUTE)).status_code == 200

    async def at(age, viewer):
        behavior['now'] = NOW + age
        return await client.get(ROUTE, headers={'x-vercel-forwarded-for': viewer})

    delayed = (await at(1201, 'a')).json()
    assert delayed['state'] == 'stale' and delayed['current']['humidity_pct'] == 0
    daily_only = (await at(3001, 'b')).json()
    assert daily_only['state'] == 'fresh' and daily_only['current'] == {'humidity_pct': None, 'pressure_msl_hpa': None}
    assert daily_only['daily'][0]['low_c'] == 25
    delayed_daily = (await at(3601, 'c')).json()
    assert delayed_daily['state'] == 'stale' and delayed_daily['daily'][0]['low_c'] == 25
    expired = await at(21601, 'd')
    assert expired.status_code == 503 and expired.json()['state'] == 'unavailable'
    assert expired.json()['fetched_at'] == NOW and expired.json()['observed_at'] == VALID
    assert expired.json()['daily'][0] == {'date': '2026-12-02', 'weather_code': None, 'low_c': None, 'high_c': None}


@pytest.mark.asyncio
async def test_outlook_failed_refresh_keeps_last_successful_fields_and_retrieval_time(outlook, command):
    client, behavior, requests, prefix, *_ = outlook
    first = (await client.get(ROUTE)).json()
    command('DEL', prefix + ':retry')
    behavior['now'] += 250
    behavior['status'] = 503
    cached = await client.get(ROUTE)
    after = await client.get(ROUTE)
    assert cached.status_code == after.status_code == 200
    for frame in (cached.json(), after.json()):
        assert frame['state'] == 'stale' and frame['retry_after'] >= 1799
        for key in ('observed_at', 'fetched_at', 'daily', 'current'):
            assert frame[key] == first[key]
    assert len(requests) == 2


@pytest.mark.asyncio
async def test_outlook_concurrent_viewers_share_one_provider_call(outlook):
    client, behavior, requests, _, started, release = outlook
    behavior['hold'] = True
    leader = asyncio.create_task(client.get(ROUTE, headers={'x-vercel-forwarded-for': 'leader'}))
    start_signal = asyncio.create_task(started.wait())
    try:
        await asyncio.wait({leader, start_signal}, timeout=2, return_when=asyncio.FIRST_COMPLETED)
        assert started.is_set(), leader.result().text if leader.done() else 'No request reached the provider'
        followers = await asyncio.gather(*(client.get(ROUTE, headers={'x-vercel-forwarded-for': str(i)}) for i in range(8)))
        assert len(requests) == 1
        assert all(r.status_code == 202 and r.headers['retry-after'] == '15' for r in followers)
        assert all(r.json()['retry_after'] == 15 and r.headers['cache-control'] == 'no-store' for r in followers)
        release.set()
        fresh = await leader
        cached = await client.get(ROUTE, headers={'x-vercel-forwarded-for': '0'})
        assert fresh.status_code == cached.status_code == 200
        assert fresh.json()['daily'] == cached.json()['daily']
        assert fresh.json()['fetched_at'] == cached.json()['fetched_at'] == NOW
        assert len(requests) == 1
    finally:
        release.set()
        start_signal.cancel()
        await asyncio.gather(leader, start_signal, return_exceptions=True)

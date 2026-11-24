"""Real Redis Lua and mocked HTTP verify shared weather behavior across instances."""
import asyncio
import json
import uuid
from datetime import datetime, timezone

import httpx
import pytest

from backend.tests.test_cloud import redis_port, command
from backend.tests.test_weather import wind_payload, radar_payload, NOW


@pytest.fixture
def weather_factory(command):
    from backend.app.weather import WeatherCache, WeatherFeed
    namespace = 'test:weather:' + uuid.uuid4().hex
    requests = []
    behavior = {'status': 200}
    async def transport(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requests.append(str(request.url))
        if behavior['status'] != 200:
            return httpx.Response(behavior['status'], headers={'Retry-After': '900'}, text='private provider details')
        data = radar_payload() if request.url.path.endswith('/70km') else wind_payload('degrees', 90) if request.url.path.endswith('wind-direction') else wind_payload()
        return httpx.Response(200, json=data)
    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    def make(layer='wind'):
        cache = WeatherCache(client, 'https://redis.example', 'test-secret', layer, prefix=namespace)
        return WeatherFeed(cache, client, clock=lambda: NOW)
    return make, requests, behavior, client


@pytest.mark.asyncio
async def test_instances_share_weather_and_independent_layer_leases(weather_factory):
    make, requests, _, client = weather_factory
    try:
        first = await make().snapshot('one')
        second = await make().snapshot('two')
        radar = await make('radar').snapshot('three')
        assert first == second and first['stations'][0]['speed_mps'] == pytest.approx(5.144444444)
        assert radar['radar']['west'] == 103.342685
        assert len(requests) == 3
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_parallel_refresh_is_deduplicated_and_late_owner_is_fenced(weather_factory, command):
    from backend.app.weather import WeatherUnavailable
    make, requests, _, client = weather_factory
    try:
        outcomes = await asyncio.gather(*(make().snapshot(str(i)) for i in range(10)), return_exceptions=True)
        assert any(isinstance(x, dict) and x['state'] == 'fresh' for x in outcomes)
        assert all(isinstance(x, (dict, WeatherUnavailable)) for x in outcomes)
        assert len(requests) == 2
        cache = make().cache
        assert not await cache.publish('wrong-owner', {'frame': outcomes[0]}, 60)
    finally: await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 403, 429, 503])
async def test_denial_and_retry_survive_new_instances(weather_factory, command, status):
    from backend.app.weather import WeatherUnavailable
    make, requests, behavior, client = weather_factory
    behavior['status'] = status
    try:
        for i in range(2):
            with pytest.raises(WeatherUnavailable) as exc:
                await make().snapshot(str(i))
            assert exc.value.frame['state'] == 'unavailable'
            assert 'private' not in json.dumps(exc.value.frame)
        assert len(requests) == 1  # denial stops the second wind request, too
        cache = make().cache
        if status in (401, 403):
            command('DEL', cache.prefix + ':retry')
            with pytest.raises(WeatherUnavailable): await make().snapshot('later')
            assert len(requests) == 1
        else: assert exc.value.frame['retry_after'] >= 899
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_crashed_refresh_reservation_and_stale_cache(weather_factory, command):
    from backend.app.weather import WeatherUnavailable
    make, requests, behavior, client = weather_factory
    try:
        first = await make().snapshot('one')
        cache = make().cache
        command('DEL', cache.prefix + ':retry')
        claim = await cache.claim('crash')
        assert claim.token
        command('DEL', cache.prefix + ':lease')
        behavior['status'] = 503
        following = await make().snapshot('next')
        assert following['fetched_at'] == first['fetched_at'] and len(requests) == 2
        command('DEL', cache.prefix + ':retry')
        stale = await make().snapshot('failed')
        assert stale['state'] == 'stale' and stale['stations']
        assert len(requests) == 3
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_request_limits_shared_between_layers_and_monthly_budget(weather_factory, command):
    from backend.app.weather import WeatherLimited
    make, _, _, client = weather_factory
    try:
        for i in range(4): await make('wind' if i % 2 else 'radar').cache.claim('same')
        with pytest.raises(WeatherLimited): await make().cache.claim('same')
        await make().cache.claim('other')
        cache = make().cache
        command('SET', cache.month_key, 100000)
        with pytest.raises(WeatherLimited) as exc: await make('radar').cache.claim('new')
        assert exc.value.retry_after > 60
    finally: await client.aclose()


def test_endpoint_validates_query_and_returns_cors_errors(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.cloud import create_cloud_app
    from backend.app.weather import WeatherCache
    from backend.app.cloud_cache import CacheUnavailable
    async def fail(*args): raise CacheUnavailable()
    monkeypatch.setattr(WeatherCache, 'claim', fail)
    with TestClient(create_cloud_app()) as client:
        for query in ['', '?layer=other', '?layer=wind&url=https://evil.example', '?layer=wind&layer=radar']:
            assert client.get('/api/weather' + query).status_code == 400
        response = client.get('/api/weather?layer=wind', headers={'Origin': 'https://perryong.github.io'})
        assert response.status_code == 503
        assert response.headers['access-control-allow-origin'] == 'https://perryong.github.io'
        assert response.headers['retry-after'] == '60'
        assert response.json()['state'] == 'unavailable'
        assert 'secret' not in response.text


@pytest.mark.asyncio
async def test_global_limit_prevents_extra_provider_work(weather_factory, command):
    from backend.app.weather import WeatherLimited
    make, requests, _, client = weather_factory
    try:
        cache = make().cache
        minute = int(command('TIME')[0]) // 60
        command('SET', cache.rate_prefix + ':global:' + str(minute), 20)
        with pytest.raises(WeatherLimited): await make().snapshot('last')
        assert requests == []
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_failed_publish_cannot_cause_immediate_repoll(weather_factory, command):
    from backend.app.cloud_cache import CacheUnavailable
    from backend.app.weather import WeatherUnavailable
    make, requests, _, client = weather_factory
    feed = make()
    async def fail(*args): raise CacheUnavailable()
    feed.cache.publish = fail
    try:
        with pytest.raises(CacheUnavailable): await feed.snapshot('first')
        command('DEL', feed.cache.prefix + ':lease')
        with pytest.raises(WeatherUnavailable): await make().snapshot('second')
        assert len(requests) == 2
    finally: await client.aclose()


def test_http_endpoint_shares_real_cache_and_accepts_only_fixed_upstreams(command, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app import weather
    from backend.app.cloud import create_cloud_app
    namespace = 'test:weather:http:' + uuid.uuid4().hex
    requested = []
    real_client, real_cache = httpx.AsyncClient, weather.WeatherCache
    def cache(*args, **kwargs): return real_cache(*args, **kwargs, prefix=namespace)
    async def transport(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requested.append(str(request.url))
        assert request.headers.get('x-api-key') == 'test-only-key'
        data = wind_payload('degrees', 90) if request.url.path.endswith('wind-direction') else wind_payload()
        data['data']['readings'][0]['timestamp'] = datetime.now(timezone.utc).replace(second=0, microsecond=0).isoformat()
        return httpx.Response(200, json=data)
    monkeypatch.setattr(weather, 'WeatherCache', cache)
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(transport)))
    monkeypatch.setenv('KV_REST_API_URL', 'https://redis.example')
    monkeypatch.setenv('KV_REST_API_TOKEN', 'test-secret')
    monkeypatch.setenv('DATAGOV_API_KEY', 'test-only-key')
    with TestClient(create_cloud_app()) as client:
        for _ in range(2):
            response = client.get('/api/weather?layer=wind', headers={'Origin': 'https://perryong.github.io'})
            assert response.status_code == 200
            assert response.json()['state'] == 'fresh' and response.json()['stations']
            assert response.headers['access-control-allow-origin'] == 'https://perryong.github.io'
            assert 'test-only-key' not in response.text
        assert requested == ['https://api-open.data.gov.sg/v2/real-time/api/wind-speed',
                             'https://api-open.data.gov.sg/v2/real-time/api/wind-direction']
        for _ in range(3): response = client.get('/api/weather?layer=wind')
        assert response.status_code == 429 and response.headers['retry-after'] == '60'

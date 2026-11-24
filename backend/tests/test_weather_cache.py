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
        fresh = next((x for x in outcomes if isinstance(x, dict) and x['state'] == 'fresh'), None)
        assert fresh is not None
        assert all(isinstance(x, (dict, WeatherUnavailable)) for x in outcomes)
        assert len(requests) == 2
        cache = make().cache
        assert not await cache.publish('wrong-owner', {'frame': fresh}, 60)
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


@pytest.fixture
def regional_factory(command):
    from backend.app.weather import WeatherCache, WeatherFeed
    from backend.tests.test_regional_weather import model_payload, wide_payload
    namespace = 'test:weather:regional:' + uuid.uuid4().hex
    requests = []
    behavior = {'statuses': {}, 'started': asyncio.Event(), 'release': asyncio.Event(), 'hold': False}
    async def transport(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requests.append(request)
        if behavior['hold']:
            behavior['started'].set()
            await behavior['release'].wait()
        status = behavior['statuses'].get(request.url.host, 200)
        if status != 200: return httpx.Response(status, headers={'Retry-After': '1200'})
        if request.url.host == 'api.open-meteo.com': data = model_payload()
        elif request.url.path.endswith('/480km'): data = wide_payload()
        elif request.url.path.endswith('/70km'): data = radar_payload()
        else: data = wind_payload('degrees', 90) if request.url.path.endswith('wind-direction') else wind_payload()
        return httpx.Response(200, json=data)
    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    def make(layer='wind_regional'):
        return WeatherFeed(WeatherCache(client, 'https://redis.example', 'test-secret', layer, prefix=namespace), client, clock=lambda: NOW)
    return make, requests, behavior, client


@pytest.mark.asyncio
async def test_regional_provider_query_and_nea_only_credentials(regional_factory, monkeypatch):
    make, requests, _, client = regional_factory
    monkeypatch.setenv('DATAGOV_API_KEY', 'nea-test-key')
    try:
        first = await make().snapshot('one')
        second = await make().snapshot('two')
        wide = await make('radar_wide').snapshot('three')
        legacy = await make('radar').snapshot('four')
        assert first['points'] == second['points'] and len(first['points']) == 49
        assert first['observed_at'] == second['observed_at'] and second['retry_after'] >= 899
        assert wide['range_km'] == 480 and 'range_km' not in legacy
        assert len(requests) == 3
        model = requests[0]
        assert model.url.host == 'api.open-meteo.com' and model.url.path == '/v1/forecast'
        assert 'x-api-key' not in model.headers and 'authorization' not in model.headers
        params = dict(model.url.params)
        assert len(params.pop('latitude').split(',')) == 49
        assert len(params.pop('longitude').split(',')) == 49
        assert params == {'current': 'wind_speed_10m,wind_direction_10m', 'wind_speed_unit': 'ms',
                          'timeformat': 'unixtime', 'timezone': 'UTC', 'forecast_days': '1', 'cell_selection': 'nearest'}
        assert requests[1].url.path.endswith('/480km') and requests[2].url.path.endswith('/70km')
        assert all(r.headers.get('x-api-key') == 'nea-test-key' for r in requests[1:])
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_regional_concurrent_followers_wait_for_single_refresh(regional_factory):
    from backend.app.weather import WeatherUnavailable
    make, requests, behavior, client = regional_factory
    behavior['hold'] = True
    leader = asyncio.create_task(make().snapshot('leader'))
    try:
        await asyncio.wait_for(behavior['started'].wait(), 2)
        followers = await asyncio.gather(*(make().snapshot(str(i)) for i in range(8)), return_exceptions=True)
        assert len(requests) == 1
        assert all(isinstance(result, WeatherUnavailable) for result in followers)
        assert all(result.frame['retry_after'] >= 899 for result in followers)
        behavior['release'].set()
        first = await leader
        cached = await make().snapshot('cached')
        assert first['points'] == cached['points'] and len(cached['points']) == 49
        assert first['observed_at'] == cached['observed_at'] and cached['retry_after'] >= 899
        assert len(requests) == 1
        assert not await make().cache.publish('expired-owner', {'frame': first}, 900)
    finally:
        behavior['release'].set()
        await asyncio.gather(leader, return_exceptions=True)
        await client.aclose()


@pytest.mark.asyncio
async def test_regional_crash_reserves_full_900_second_cadence(regional_factory, command):
    from backend.app.weather import WeatherUnavailable
    make, requests, _, client = regional_factory
    try:
        feed = make()
        claim = await feed.cache.claim('crashed')
        assert claim.token and claim.retry_after == 900
        assert int(command('TTL', feed.cache.prefix + ':retry')) >= 899
        command('DEL', feed.cache.prefix + ':lease')
        with pytest.raises(WeatherUnavailable) as result: await make().snapshot('later')
        assert result.value.frame['retry_after'] >= 899 and requests == []
    finally: await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 403, 429, 503])
async def test_model_denial_and_backoff_do_not_disable_nea(regional_factory, command, status):
    from backend.app.weather import WeatherUnavailable
    make, requests, behavior, client = regional_factory
    behavior['statuses']['api.open-meteo.com'] = status
    try:
        with pytest.raises(WeatherUnavailable) as first: await make().snapshot('first')
        assert first.value.frame['retry_after'] >= 1800
        if status in (401, 403): command('DEL', make().cache.prefix + ':retry')
        with pytest.raises(WeatherUnavailable): await make().snapshot('second')
        assert len(requests) == 1
        radar = await make('radar_wide').snapshot('third')
        assert radar['state'] == 'fresh' and len(requests) == 2
        assert command('EXISTS', make('radar_wide').cache.prefix + ':denied') == 0
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_all_four_layers_share_monthly_and_viewer_limits(regional_factory, command):
    from backend.app.weather import WeatherLimited
    make, requests, _, client = regional_factory
    try:
        for layer in ('wind', 'radar', 'wind_regional', 'radar_wide'):
            assert (await make(layer).cache.claim('shared')).token
        with pytest.raises(WeatherLimited): await make().cache.claim('shared')
        cache = make().cache
        assert int(command('GET', cache.month_key)) == 5*32
        command('SET', cache.month_key, 100000)
        for layer in ('wind', 'radar', 'wind_regional', 'radar_wide'):
            with pytest.raises(WeatherLimited): await make(layer).snapshot('new')
        assert requests == []
    finally: await client.aclose()


def test_new_http_layers_use_real_redis_and_cannot_change_fixed_coordinates(command, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app import weather
    from backend.app.cloud import create_cloud_app
    from backend.tests.test_regional_weather import model_payload, wide_payload
    namespace = 'test:weather:regional-http:' + uuid.uuid4().hex
    requested = []
    real_client, real_cache = httpx.AsyncClient, weather.WeatherCache
    async def transport(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requested.append(request)
        now = datetime.now(timezone.utc)
        if request.url.host == 'api.open-meteo.com':
            data = model_payload()
            for p in data: p['current']['time'] = int(now.timestamp()) - 60
        else:
            data = wide_payload()
            data['data']['records'][0]['timestamp'] = now.isoformat()
            data['data']['records'][0]['image']['urlExpiresAt'] = datetime.fromtimestamp(now.timestamp()+900, timezone.utc).isoformat()
        return httpx.Response(200, json=data)
    monkeypatch.setattr(weather, 'WeatherCache', lambda *args, **kwargs: real_cache(*args, **kwargs, prefix=namespace))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(transport)))
    monkeypatch.setenv('KV_REST_API_URL', 'https://redis.example')
    monkeypatch.setenv('KV_REST_API_TOKEN', 'test-secret')
    with TestClient(create_cloud_app()) as client:
        for layer in ('wind_regional', 'radar_wide'):
            response = client.get('/api/weather?layer='+layer, headers={'Origin': 'https://perryong.github.io'})
            assert response.status_code == 200
            assert response.json()['layer'] == layer and response.json()['state'] == 'fresh'
            assert response.headers['access-control-allow-origin'] == 'https://perryong.github.io'
        assert len(requested) == 2
        for suffix in ('&latitude=20', '&longitude=10', '&url=https://example.com'):
            assert client.get('/api/weather?layer=wind_regional'+suffix).status_code == 400
        assert len(requested) == 2


@pytest.mark.asyncio
async def test_regional_failed_publish_preserves_full_cadence(regional_factory, command):
    from backend.app.cloud_cache import CacheUnavailable
    from backend.app.weather import WeatherUnavailable
    make, requests, _, client = regional_factory
    feed = make()
    async def fail(*args): raise CacheUnavailable()
    feed.cache.publish = fail
    try:
        with pytest.raises(CacheUnavailable): await feed.snapshot('first')
        assert int(command('TTL', feed.cache.prefix + ':retry')) >= 899
        command('DEL', feed.cache.prefix + ':lease')
        with pytest.raises(WeatherUnavailable): await make().snapshot('second')
        assert len(requests) == 1
    finally: await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('layer,old_layer', [('wind_regional', 'wind'), ('radar_wide', 'radar')])
async def test_new_layers_reject_mismatched_legacy_cached_frame(regional_factory, command, layer, old_layer):
    make, _, _, client = regional_factory
    try:
        legacy = await make(old_layer).snapshot('old')
        cache = make(layer).cache
        command('SET', cache.prefix + ':data', json.dumps({'frame': legacy, 'failures': 0}))
        command('SET', cache.prefix + ':retry', int(command('TIME')[0])+900, 'EX', 900)
        with pytest.raises(ValueError): await make(layer).snapshot('new')
    finally: await client.aclose()

"""One-hour radar snapshots: real observations, bounded requests and shared Redis budgets."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
import uuid

import httpx
import pytest

from backend.app import weather
from backend.tests.test_cloud import redis_port, command
from backend.tests.test_regional_weather import wide_payload
from backend.tests.test_weather import NOW, HOST


def iso(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat()


def history_payload(now=NOW, offsets=range(0, -7201, -300)):
    payload = wide_payload()
    template = payload['data']['records'][0]
    end = int(now // 300) * 300
    records = []
    for offset in offsets:
        record = deepcopy(template)
        record.update(timestamp=iso(end+offset), updatedTimestamp=iso(end+offset))
        record['image'].update(url=f'https://{HOST}/fixture-{offset}.png', urlExpiresAt=iso(now+3600))
        records.append(record)
    payload['data']['records'] = records
    return payload


def normalize(payload=None, now=NOW):
    return weather.normalize_radar_history([payload or history_payload(now)], now)


def test_history_contains_thirteen_actual_ascending_observations_in_floored_hour():
    frame = normalize(now=NOW+123)
    assert frame['layer'] == 'radar_history' and frame['range_km'] == 480
    assert frame['window_start'] == NOW-3600 and frame['window_end'] == NOW
    assert frame['expected_frames'] == 13 and frame['state'] == 'fresh'
    assert frame['observed_at'] == NOW and frame['fetched_at'] == NOW+123
    assert [f['observed_at'] for f in frame['frames']] == list(range(int(NOW-3600), int(NOW+1), 300))
    assert frame['frames'][0]['west'] == 99.638609
    assert frame['frames'][0]['south'] == -2.967382
    assert 'radar' not in frame


def test_history_deduplicates_and_keeps_gaps_without_inventing_frames():
    frame = normalize(history_payload(offsets=[0, -600, -600, -3600, -3900, 300]))
    assert [f['observed_at'] for f in frame['frames']] == [NOW-3600, NOW-600, NOW]
    assert frame['expected_frames'] == 13
    # Even an unexpected high-frequency provider response cannot grow the cache.
    assert len(normalize(history_payload(offsets=range(0, -3601, -60)))['frames']) == 13


@pytest.mark.parametrize('damage', ['expired', 'host', 'credentials', 'port', 'range', 'format', 'time', 'missing', 'null'])
def test_history_omits_individual_invalid_records(damage):
    payload = history_payload(offsets=[0, -300])
    record = payload['data']['records'][0]
    if damage == 'expired': record['image']['urlExpiresAt'] = iso(NOW)
    if damage == 'host': record['image']['url'] = 'https://evil.example/frame.png'
    if damage == 'credentials': record['image']['url'] = f'https://user@{HOST}/frame.png'
    if damage == 'port': record['image']['url'] = f'https://{HOST}:1234/frame.png'
    if damage == 'range': record['image']['range'] = '70km'
    if damage == 'format': record['image']['format'] = 'jpeg'
    if damage == 'time': record['timestamp'] = 'not-a-time'
    if damage == 'missing': record['image'].pop('urlExpiresAt')
    if damage == 'null': payload['data']['records'][0] = None
    frame = normalize(payload)
    assert len(frame['frames']) == 1 and frame['observed_at'] == NOW-300


@pytest.mark.parametrize('damage', ['bounds', 'crs', 'projection', 'center', 'records'])
def test_history_rejects_unsupported_geometry_or_payload(damage):
    payload = history_payload()
    if damage == 'bounds': payload['data']['boundaryBox']['upperLeft']['longitude'] = 103
    if damage == 'crs': payload['data']['boundaryBox']['crs'] = 'EPSG:3857'
    if damage == 'projection': payload['data']['projection']['type'] = 'Mercator'
    if damage == 'center': payload['data']['projection']['center']['latitude'] = 50
    if damage == 'records': payload['data']['records'] = {}
    with pytest.raises(ValueError): normalize(payload)


def test_history_freshness_uses_snapshot_and_filters_expiry_without_shifting_window():
    frame = normalize(history_payload(offsets=[-3600, -300]))
    frame['frames'][-1]['expires_at'] = NOW+200
    rendered = weather.render(frame, NOW+300)
    assert rendered['state'] == 'fresh' and rendered['observed_at'] == NOW-3600
    assert rendered['window_start'] == NOW-3600 and rendered['window_end'] == NOW
    assert rendered['fetched_at'] == NOW and len(rendered['frames']) == 1
    assert weather.render(frame, NOW+601)['state'] == 'stale'
    expired = weather.render(frame, NOW+901)
    assert expired['state'] == 'unavailable' and expired['frames'] == [] and expired['observed_at'] is None
    assert len(frame['frames']) == 2


def test_history_window_age_hard_limit_and_empty_expired_snapshot():
    frame = normalize(now=NOW+299)
    assert weather.render(frame, NOW+901)['state'] == 'unavailable'
    for image in frame['frames']: image['expires_at'] = NOW+400
    empty = weather.render(frame, NOW+401)
    assert empty['frames'] == [] and empty['observed_at'] is None and empty['state'] == 'unavailable'


@pytest.mark.parametrize('damage', ['host', 'bounds', 'range', 'window', 'future', 'unsnapped', 'duplicate', 'order', 'outside', 'count', 'expected', 'observed', 'fetched'])
def test_history_rejects_corrupt_cached_snapshots(damage):
    frame = normalize()
    if damage == 'host': frame['frames'][0]['url'] = 'https://evil.example/frame.png'
    if damage == 'bounds': frame['frames'][0]['west'] = 103
    if damage == 'range': frame['range_km'] = 70
    if damage == 'window': frame['window_start'] -= 300
    if damage == 'future': frame['window_end'] += 300
    if damage == 'unsnapped':
        frame['window_start'] += 1; frame['window_end'] += 1
    if damage == 'duplicate': frame['frames'][1] = deepcopy(frame['frames'][0])
    if damage == 'order': frame['frames'].reverse()
    if damage == 'outside': frame['frames'][0]['observed_at'] -= 300
    if damage == 'count': frame['frames'].append(deepcopy(frame['frames'][-1]))
    if damage == 'expected': frame['expected_frames'] = 26
    if damage == 'observed': frame['observed_at'] -= 300
    if damage == 'fetched': frame['fetched_at'] = None
    with pytest.raises(ValueError): weather.render(frame, NOW)


@pytest.fixture
def history_factory(command):
    namespace = 'test:weather:history:' + uuid.uuid4().hex
    requests = []
    behavior = {'status': 200, 'now': NOW, 'hold': False, 'started': asyncio.Event(), 'release': asyncio.Event()}
    async def transport(request):
        if request.url.host == 'redis.example':
            result = await asyncio.to_thread(command, *json.loads(request.content))
            return httpx.Response(200, json={'result': result})
        requests.append(request)
        if behavior['hold']:
            behavior['started'].set()
            await behavior['release'].wait()
        if behavior['status'] != 200: return httpx.Response(behavior['status'], headers={'Retry-After': '1200'})
        payload = history_payload(behavior['now'])
        # Provider day results contain only that calendar day's records.
        day = request.url.params.get('date')
        if day:
            payload['data']['records'] = [r for r in payload['data']['records']
                if datetime.fromtimestamp(weather.timestamp(r['timestamp'])+28800, timezone.utc).strftime('%Y-%m-%d') == day]
        return httpx.Response(200, json=payload)
    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    def make(layer='radar_history'):
        return weather.WeatherFeed(weather.WeatherCache(client, 'https://redis.example', 'secret', layer, prefix=namespace),
                                   client, clock=lambda: behavior['now'])
    return make, requests, behavior, client


@pytest.mark.asyncio
@pytest.mark.parametrize('now,days', [
    ('2026-11-25T03:02:00+00:00', ['2026-11-25']),
    ('2026-11-24T16:02:00+00:00', ['2026-11-25', '2026-11-24']),
    ('2026-11-24T16:32:00+00:00', ['2026-11-25', '2026-11-24']),
    ('2026-11-24T17:02:00+00:00', ['2026-11-25']),
])
async def test_history_fetches_only_one_or_two_fixed_sgt_days(history_factory, monkeypatch, now, days):
    make, requests, behavior, client = history_factory
    behavior['now'] = datetime.fromisoformat(now).timestamp()
    monkeypatch.setenv('DATAGOV_API_KEY', 'nea-test-key')
    try:
        first = await make().snapshot('one')
        second = await make().snapshot('two')
        assert len(first['frames']) == 13 and second['frames'] == first['frames']
        assert [dict(r.url.params) for r in requests] == [{'date': d} for d in days]
        assert all(r.url.path.endswith('/480km') and r.url.host == 'api-open.data.gov.sg' for r in requests)
        assert all(r.headers.get('x-api-key') == 'nea-test-key' for r in requests)
        assert len(json.dumps(first)) < 100_000
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_history_concurrent_requests_share_refresh_and_crash_reservation(history_factory, command):
    make, requests, behavior, client = history_factory
    behavior['hold'] = True
    leader = asyncio.create_task(make().snapshot('leader'))
    try:
        await asyncio.wait_for(behavior['started'].wait(), 2)
        followers = await asyncio.gather(*(make().snapshot(str(i)) for i in range(8)), return_exceptions=True)
        assert len(requests) == 1
        assert all(isinstance(result, weather.WeatherUnavailable) for result in followers)
        behavior['release'].set()
        first = await leader
        cache = make().cache
        assert not await cache.publish('wrong-owner', {'frame': first}, 300)
        command('DEL', cache.prefix+':retry')
        claim = await cache.claim('crashed')
        assert claim.token and claim.retry_after == 300
        command('DEL', cache.prefix+':lease')
        assert (await make().snapshot('later'))['frames'] == first['frames']
        assert len(requests) == 2  # The fixture hour crosses Singapore midnight.
    finally:
        behavior['release'].set()
        await asyncio.gather(leader, return_exceptions=True)
        await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 403, 429, 503])
async def test_history_denial_and_backoff_survive_new_instances(history_factory, command, status):
    make, requests, behavior, client = history_factory
    behavior['status'] = status
    try:
        with pytest.raises(weather.WeatherUnavailable): await make().snapshot('first')
        if status in (401, 403): command('DEL', make().cache.prefix+':retry')
        with pytest.raises(weather.WeatherUnavailable): await make().snapshot('second')
        assert len(requests) == 1
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_history_failed_refresh_keeps_safe_cached_observations_and_original_window(history_factory, command):
    make, requests, behavior, client = history_factory
    try:
        original = await make().snapshot('first')
        original['frames'][-1]['expires_at'] = NOW+100
        cache = make().cache
        command('SET', cache.prefix+':data', json.dumps({'frame': original, 'failures': 0}))
        command('DEL', cache.prefix+':retry')
        behavior.update(status=503, now=NOW+300)
        stale = await make().snapshot('next')
        assert stale['state'] == 'stale' and len(stale['frames']) == 12
        assert stale['window_start'] == NOW-3600 and stale['window_end'] == NOW
        assert stale['observed_at'] == NOW-300 and stale['fetched_at'] == NOW
        behavior['now'] = NOW+901
        with pytest.raises(weather.WeatherUnavailable) as result: await make().snapshot('old')
        assert result.value.frame['frames'] == [] and result.value.frame['observed_at'] is None
        assert len(requests) == 3  # Two successful day pages, then one failed refresh.
    finally: await client.aclose()


@pytest.mark.asyncio
async def test_history_uses_existing_monthly_viewer_and_global_allowances(history_factory, command):
    make, requests, _, client = history_factory
    try:
        for layer in ('wind', 'radar', 'wind_regional', 'radar_wide'):
            await make(layer).cache.claim('same')
        with pytest.raises(weather.WeatherLimited): await make().snapshot('same')
        cache = make().cache
        assert int(command('GET', cache.month_key)) == 5*32
        command('SET', cache.month_key, 100000)
        with pytest.raises(weather.WeatherLimited): await make().snapshot('new')
        assert requests == []
        command('SET', cache.month_key, 0)
        minute = int(command('TIME')[0])//60
        command('SET', cache.rate_prefix+':global:'+str(minute), 20)
        with pytest.raises(weather.WeatherLimited): await make().snapshot('other')
        assert requests == []
    finally: await client.aclose()


def test_history_http_rejects_client_dates_and_retains_envelope_on_cache_failure(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.cloud import create_cloud_app
    from backend.app.cloud_cache import CacheUnavailable
    async def fail(*args): raise CacheUnavailable()
    monkeypatch.setattr(weather.WeatherCache, 'claim', fail)
    with TestClient(create_cloud_app()) as client:
        response = client.get('/api/weather?layer=radar_history')
        assert response.status_code == 503
        frame = response.json()
        assert frame['layer'] == 'radar_history' and frame['expected_frames'] == 13 and frame['frames'] == []
        assert frame['window_end']-frame['window_start'] == 3600 and frame['window_end'] % 300 == 0
        assert frame['observed_at'] is None and frame['fetched_at'] is None
        for suffix in ('&date=2026-11-24', '&url=https://example.com', '&layer=radar'):
            assert client.get('/api/weather?layer=radar_history'+suffix).status_code == 400

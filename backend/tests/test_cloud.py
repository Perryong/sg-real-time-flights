"""Exercise the real Lua coordination against a disposable local Redis."""
import asyncio
import json
import shutil
import socket
import subprocess
import time
import uuid

import httpx
import pytest

@pytest.fixture(scope='module')
def redis_port(tmp_path_factory):
    if not shutil.which('redis-server') or not shutil.which('redis-cli'):
        pytest.skip('redis-server and redis-cli are required for cloud integration tests')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    process = subprocess.Popen(['redis-server', '--port', str(port), '--bind', '127.0.0.1',
        '--save', '', '--appendonly', 'no', '--dir', str(tmp_path_factory.mktemp('redis'))],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if subprocess.run(['redis-cli', '-p', str(port), 'PING'], capture_output=True).stdout.strip() == b'PONG': break
            time.sleep(.02)
        else: raise RuntimeError('Redis did not start')
        yield port
    finally:
        process.terminate(); process.wait(timeout=5)

@pytest.fixture
def command(redis_port):
    def run(*args):
        result = subprocess.run(['redis-cli', '-p', str(redis_port), '--json', *map(str,args)], capture_output=True, text=True, check=True)
        return json.loads(result.stdout)
    return run

@pytest.fixture
def cache_factory(command):
    from backend.app.cloud_cache import RedisCache
    async def transport(request):
        result = await asyncio.to_thread(command, *json.loads(request.content))
        return httpx.Response(200, json={'result':result})
    def make(namespace=None):
        client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        return RedisCache(client, 'https://redis.example', 'private-test-token', namespace or uuid.uuid4().hex)
    return make

@pytest.mark.asyncio
async def test_only_one_instance_claims_refresh_and_old_owner_cannot_publish(cache_factory, command):
    cache = cache_factory()
    claims = await asyncio.gather(*(cache.claim(str(i)) for i in range(20)))
    owners = [claim for claim in claims if claim.token]
    assert len(owners) == 1
    owner = owners[0]
    assert not await cache.publish('wrong-token', {'hello':'wrong'})
    assert await cache.publish(owner.token, {'hello':'shared'})
    assert (await cache_factory(cache.prefix).claim('next')).state == {'hello':'shared'}
    command('DEL', cache.prefix+':ready')
    old = await cache.claim('old')
    command('DEL', cache.prefix+':lease')
    new = await cache.claim('new')
    assert old.token and new.token
    assert not await cache.publish(old.token, {'hello':'obsolete'})
    assert await cache.publish(new.token, {'hello':'new'})

@pytest.mark.asyncio
async def test_limits_do_not_start_refresh(cache_factory):
    from backend.app.cloud_cache import CacheLimited
    cache = cache_factory()
    for _ in range(8): await cache.claim('one-viewer')
    with pytest.raises(CacheLimited): await cache.claim('one-viewer')
    other = cache_factory()
    for i in range(60): await other.claim(str(i))
    with pytest.raises(CacheLimited): await other.claim('sixty-first')

@pytest.mark.asyncio
async def test_unavailable_cache_never_falls_back_to_upstream():
    from backend.app.cloud_cache import RedisCache, CacheUnavailable
    async def transport(request): return httpx.Response(429, json={'error':'quota exceeded'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        with pytest.raises(CacheUnavailable):
            await RedisCache(client, 'https://redis.example', 'secret').claim('viewer')

@pytest.mark.asyncio
async def test_shared_snapshots_preserve_backoff_history_and_original_timestamps(cache_factory, command):
    from backend.app.cloud import CloudFeed
    from backend.app.provider import ProviderResult, ProviderError
    from backend.app.normalize import normalize_record
    from backend.app.config import Settings
    now = [1795300000.0]
    class Provider:
        def __init__(self): self.calls=0
        async def fetch(self):
            self.calls += 1
            record = {'hex':'abc123','lat':1.35,'lon':104,'seen_pos':0,'alt_baro':1000}
            return ProviderResult([normalize_record(record, now[0], now[0], 'live', True)], 0)
    class Limited:
        def __init__(self): self.calls=0
        async def fetch(self): self.calls += 1; raise ProviderError('429',retry_after=120)
    primary, regional = Provider(), Limited()
    cache = cache_factory()
    settings = Settings(live_enabled=True, flyitaly_enabled=True)
    async with httpx.AsyncClient() as client:
        def feed(): return CloudFeed(cache, client, settings, clock=lambda:now[0], providers=(primary,regional))
        first = await feed().snapshot('viewer')
        cached = await feed().snapshot('viewer')
        assert primary.calls == 1 and regional.calls == 1
        assert first.epoch == cached.epoch and first.sequence == cached.sequence
        assert first.status.collection_mode == 'on_demand'
        assert first.status.movements.landings == first.status.movements.takeoffs == 0
        stamp = first.tracks[0].latest.position_time
        now[0] += 16; command('DEL',cache.prefix+':ready')
        second = await feed().snapshot('viewer')
        assert primary.calls == 2 and regional.calls == 1
        assert second.sequence > first.sequence and second.epoch == first.epoch
        assert second.tracks[0].history[0].position_time == stamp
        now[0] += 121
        # A cached old response must hide expired positions without refreshing their timestamps.
        stale = await feed().snapshot('viewer')
        assert not stale.tracks and stale.status.upstream_state == 'unavailable'
        assert stale.server_time == second.server_time

@pytest.mark.asyncio
async def test_throttled_viewer_does_not_exhaust_other_viewers_budget(cache_factory):
    from backend.app.cloud_cache import CacheLimited
    cache=cache_factory()
    for _ in range(65):
        try: await cache.claim('noisy')
        except CacheLimited: pass
    await cache.claim('legitimate')

@pytest.mark.asyncio
async def test_source_retry_is_saved_even_if_final_snapshot_publish_crashes(cache_factory,command):
    from backend.app.cloud import CloudFeed
    from backend.app.cloud_cache import CacheUnavailable
    from backend.app.provider import ProviderError
    from backend.app.config import Settings
    now=[1795300000.0]
    class Denied:
        def __init__(self): self.calls=0
        async def fetch(self): self.calls+=1; raise ProviderError('429',retry_after=120)
    primary,regional=Denied(),Denied()
    cache=cache_factory()
    original=cache.publish
    async def crash(*args): raise CacheUnavailable()
    cache.publish=crash
    async with httpx.AsyncClient() as client:
        with pytest.raises(CacheUnavailable):
            await CloudFeed(cache,client,Settings(live_enabled=True),clock=lambda:now[0],providers=(primary,regional)).snapshot('viewer')
        command('DEL',cache.prefix+':lease'); now[0]+=40;cache.publish=original
        frame=await CloudFeed(cache,client,Settings(live_enabled=True),clock=lambda:now[0],providers=(primary,regional)).snapshot('viewer')
        assert primary.calls==1 and regional.calls==1
        assert not frame.tracks and frame.status.upstream_state=='unavailable'
        assert frame.status.sources['adsb.fi'].next_retry==1795300120

@pytest.mark.parametrize('limited,expected',[(True,429),(False,503)])
def test_cloud_http_errors_are_safe_and_retryable(monkeypatch,limited,expected):
    from fastapi.testclient import TestClient
    from backend.app.cloud import create_cloud_app
    from backend.app.cloud_cache import RedisCache,CacheLimited,CacheUnavailable
    from backend.app.config import Settings
    async def fail(*args): raise CacheLimited() if limited else CacheUnavailable()
    monkeypatch.setattr(RedisCache,'claim',fail)
    with TestClient(create_cloud_app(Settings(live_enabled=True))) as client:
        response=client.get('/api/aircraft',headers={'Origin':'https://perryong.github.io'})
        assert response.status_code==expected
        assert response.headers['retry-after']=='60'
        assert response.headers['access-control-allow-origin']=='https://perryong.github.io'
        assert 'token' not in response.text.lower()
        assert client.get('/api/aircraft?latitude=0').status_code==400
        assert client.get('/api/health',headers={'Origin':'https://evil.example'}).headers.get('access-control-allow-origin') is None


@pytest.mark.asyncio
@pytest.mark.parametrize('kind',['landing','takeoff'])
async def test_cloud_movements_survive_instances_cached_viewers_and_idle_midnight(cache_factory,command,kind):
    from backend.tests.test_movements import track,NOW
    from backend.app.cloud import CloudFeed
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult,ProviderError
    now=[NOW]
    samples=track(kind).history
    for i,o in enumerate(samples):
        o.position_time=o.receipt_time=NOW+i*15
    class Provider:
        calls=0
        failed=False
        async def fetch(self):
            self.calls+=1
            if self.failed: raise ProviderError('timeout')
            return ProviderResult([samples[min(self.calls-1,3)]],0)
    provider=Provider();cache=cache_factory()
    async with httpx.AsyncClient() as client:
        def feed():return CloudFeed(cache_factory(cache.prefix),client,Settings(live_enabled=True),clock=lambda:now[0],providers=(provider,None))
        for i in range(4):
            now[0]=NOW+i*15;command('DEL',cache.prefix+':ready')
            frame=await feed().snapshot(str(i))
        counts=frame.status.movements
        assert counts is not None
        assert getattr(counts,kind+'s')==1
        assert counts.observed_seconds==45
        cached=await asyncio.gather(*(feed().snapshot('reader'+str(i)) for i in range(5)))
        assert all(getattr(f.status.movements,kind+'s')==1 for f in cached)
        assert provider.calls==4
        now[0]+=600;provider.failed=True;command('DEL',cache.prefix+':ready')
        failed=await feed().snapshot('failed')
        assert getattr(failed.status.movements,kind+'s')==1
        assert failed.status.movements.observed_seconds==45
        assert failed.status.movements.unmonitored_seconds==12*3600+600
        now[0]=NOW+12*3600+5  # Singapore midnight + 5, with no refresh.
        midnight=await feed().snapshot('midnight')
        assert midnight.status.movements.day=='2026-11-21'
        assert midnight.status.movements.landings==midnight.status.movements.takeoffs==0
        assert midnight.status.movements.first_observed_at is None
        assert midnight.status.movements.unmonitored_seconds==5


@pytest.mark.asyncio
async def test_failed_cloud_publish_recovers_pending_event_without_losing_saved_ledger(cache_factory,command):
    from backend.tests.test_movements import track,NOW
    from backend.app.cloud import CloudFeed
    from backend.app.cloud_cache import CacheUnavailable
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult
    now=[NOW];cache=cache_factory();samples=track().history
    for i,o in enumerate(samples):o.position_time=o.receipt_time=NOW+i*15
    class Provider:
        calls=0
        async def fetch(self):
            self.calls+=1
            return ProviderResult([samples[min(self.calls-1,3)]],0)
    provider=Provider()
    async with httpx.AsyncClient() as client:
        def feed():return CloudFeed(cache,client,Settings(live_enabled=True),clock=lambda:now[0],providers=(provider,None))
        for i in range(3):
            now[0]=NOW+i*15;command('DEL',cache.prefix+':ready');await feed().snapshot(str(i))
        original=cache.publish
        async def expired_owner(token,state):
            command('DEL',cache.prefix+':lease')
            return await original(token,state)
        cache.publish=expired_owner;now[0]=NOW+45;command('DEL',cache.prefix+':ready')
        with pytest.raises(CacheUnavailable):await feed().snapshot('expired')
        cache.publish=original;now[0]+=1
        recovered=await feed().snapshot('new-owner')
        assert recovered.status.movements.landings==1
        assert recovered.status.movements.observed_seconds==45
        repeated=await feed().snapshot('cached')
        assert repeated.status.movements.landings==1
        assert provider.calls==4


@pytest.mark.asyncio
async def test_cloud_upgrade_initializes_missing_ledger_but_rejects_corrupt_saved_counts(cache_factory,command):
    from backend.app.cloud import CloudFeed
    from backend.app.config import Settings
    from backend.app.provider import ProviderResult
    from backend.tests.test_movements import NOW
    cache=cache_factory();now=[NOW]
    class Provider:
        calls=0
        async def fetch(self):self.calls+=1;return ProviderResult([],0)
    provider=Provider()
    async with httpx.AsyncClient() as client:
        def feed():return CloudFeed(cache,client,Settings(live_enabled=True),clock=lambda:now[0],providers=(provider,None))
        first=await feed().snapshot('first')
        command('DEL',cache.prefix+':ready')
        claim=await cache.claim('upgrade');old=claim.state
        old.pop('movements');old['snapshot']['status']['movements']=None
        assert await cache.publish(claim.token,old)
        now[0]+=15;command('DEL',cache.prefix+':ready')
        migrated=await feed().snapshot('upgrade-reader')
        assert migrated.status.movements.available
        assert migrated.status.movements.first_observed_at==now[0]
        command('DEL',cache.prefix+':ready')
        claim=await cache.claim('corrupt');broken=claim.state
        broken['movements']={}
        assert await cache.publish(claim.token,broken)
        command('DEL',cache.prefix+':ready');now[0]+=15
        before=provider.calls
        with pytest.raises(ValueError):await feed().snapshot('bad-ledger')
        assert provider.calls==before
        # Failed reads must leave the stored ledger untouched, never replace it with zero.
        command('DEL',cache.prefix+':lease')
        assert (await cache.claim('check')).state['movements']=={}

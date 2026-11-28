from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.cloud import create_cloud_app
from backend.app.config import Settings
from backend.app.main import create_app


@pytest.mark.parametrize('factory', [create_app, create_cloud_app])
def test_journey_is_unavailable_without_permission_and_key(factory, monkeypatch):
    monkeypatch.setenv('AEROAPI_ENABLED', 'true')
    monkeypatch.setenv('AEROAPI_API_KEY', 'paid-key')
    monkeypatch.delenv('AEROAPI_USE_CONFIRMED', raising=False)
    with TestClient(factory(Settings.from_env())) as client:
        response = client.get('/api/journey', params={'callsign':'QTR8176', 'hex':'aa1234', 'observed_at':1795900000})
    assert response.status_code == 200
    assert response.json() == {'journey': None, 'reason': 'Confirmed journeys are unavailable on this server.'}


NOW = 1795900000
FLIGHT_ID = 'QTR8176-1795864000-airline-0191'


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def airport(icao, iata, name, city):
    return {'code_icao':icao, 'code_iata':iata, 'name':name, 'city':city}


def flight(**changes):
    return {'fa_flight_id':FLIGHT_ID, 'ident':'QTR8176', 'actual_off':iso(NOW - 36000),
        'estimated_on':iso(NOW + 7200), 'registration':'A7-BFK',
        'origin':airport('OTHH', 'DOH', 'Hamad International', 'Doha'),
        'destination':airport('YSSY', 'SYD', 'Kingsford Smith', 'Sydney'), **changes}


def point(timestamp, lat, lon, altitude, kind='A'):
    return {'timestamp':iso(timestamp), 'latitude':lat, 'longitude':lon, 'altitude':altitude, 'update_type':kind}


def test_local_endpoint_rejects_unobserved_aircraft_and_duplicate_fields():
    settings = Settings(aeroapi_enabled=True, aeroapi_api_key='private-test-key')
    with TestClient(create_app(settings, clock=lambda: NOW)) as client:
        path = f'/api/journey?callsign=QTR8176&hex=aa1234&observed_at={NOW}'
        result = client.get(path)
        assert result.headers['cache-control'] == 'no-store'
        assert result.json() == {'journey':None, 'reason':'A recent Singapore position is needed to confirm this flight.', 'retryable':True}
        invalid = client.get(path + '&callsign=QTR9999').json()
        assert invalid['journey'] is None
        assert 'valid callsign' in invalid['reason']


def test_cloud_endpoint_fails_closed_without_shared_cache(monkeypatch):
    for key in ('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'):
        monkeypatch.delenv(key, raising=False)
    settings = Settings(aeroapi_enabled=True, aeroapi_api_key='private-test-key')
    with TestClient(create_cloud_app(settings)) as client:
        result = client.get('/api/journey', params={'callsign':'QTR8176', 'hex':'aa1234', 'observed_at':int(datetime.now(timezone.utc).timestamp())})
        assert result.json() == {'journey':None, 'reason':'Confirmed journeys are temporarily unavailable.', 'retryable':True}


@pytest.mark.parametrize('limit', ['0', '-1', '10001', 'oops'])
def test_zero_or_invalid_request_cap_disables_aeroapi(monkeypatch, limit):
    monkeypatch.setenv('AEROAPI_ENABLED', 'true')
    monkeypatch.setenv('AEROAPI_USE_CONFIRMED', 'true')
    monkeypatch.setenv('AEROAPI_API_KEY', 'paid-test-key')
    monkeypatch.setenv('AEROAPI_DAILY_REQUEST_LIMIT', limit)
    assert Settings.from_env().aeroapi_enabled is False


@pytest.mark.asyncio
async def test_international_leg_refresh_survives_exit_and_resolves_diversion():
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    clock = [NOW]
    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'alt_baro':36000,'seen_pos':0}, NOW, NOW, 'live', True)
    calls = []

    def respond(request):
        assert request.headers['x-apikey'] == 'private-test-key'
        calls.append(request.url)
        if request.url.path.endswith('/QTR8176'):
            assert request.url.params['max_pages'] == '1'
            return httpx.Response(200, json={'flights':[flight(), flight(fa_flight_id='previous-leg',
                actual_off=iso(NOW-64000), actual_on=iso(NOW-10000))]})
        if request.url.path.endswith('/' + FLIGHT_ID):
            assert request.url.params['ident_type'] == 'fa_flight_id'
            return httpx.Response(200, json={'flights':[flight(diverted=True), flight(actual_on=iso(NOW+200),
                destination=airport('YPDN', 'DRW', 'Darwin International', 'Darwin'))]})
        assert request.url.path.endswith('/' + FLIGHT_ID + '/track')
        assert request.url.params['include_estimated_positions'] == 'true'
        points = [point(NOW, 1.355, 103.91, 360), point(NOW-36000, 25.27, 51.61, 0),
            point(NOW-1200, 7, 98, None), point(NOW-1000, 6, 99, 380, 'P')]
        if clock[0] > NOW:
            points.append(point(NOW+190, -12.41, 130.87, 0))
        return httpx.Response(200, json={'positions':points})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        service = JourneyService(client, 'private-test-key', JourneyCache(lambda: clock[0]), lambda: clock[0])
        result = await service.lookup('QTR8176', 'aa1234', NOW, None, observed)
        journey = result['journey']
        assert journey['status'] == 'airborne'
        assert journey['origin']['iata'] == 'DOH'
        assert journey['destination']['icao'] == 'YSSY'
        assert journey['departureTime'] == NOW-36000
        assert [(p['time'], p['altitude_ft'], p['estimated']) for p in journey['points']] == [
            (NOW-36000,0,False), (NOW-1200,None,False), (NOW-1000,38000,True), (NOW,36000,False)]
        assert journey['points'][0]['lon'] == 51.61
        assert len(calls) == 2

        identifier = journey['id']
        assert (await service.lookup('QTR8176', 'aa1234', NOW, identifier, None))['journey'] == journey
        assert (await service.lookup('QTR8176', 'aa1234', NOW, identifier + 'forged', observed))['journey'] is None
        assert (await service.lookup('QTR8176', 'bb1234', NOW, identifier, None))['journey'] is None
        incompatible = observed.model_copy(update={'registration':'A7-XXX','lat':5.0})
        assert (await service.lookup('QTR8176', 'aa1234', NOW, None, incompatible))['journey'] is None
        assert len(calls) == 2

        clock[0] += 210
        complete = (await service.lookup('QTR8176', 'aa1234', NOW, identifier, None))['journey']
        assert complete['id'] == identifier
        assert complete['status'] == 'arrived'
        assert complete['arrivalTime'] == NOW+200
        assert complete['destination']['iata'] == 'DRW'
        assert complete['plannedDestination']['iata'] == 'SYD'
        assert complete['points'][-1]['lat'] == -12.41
        assert len(calls) == 4


@pytest.mark.asyncio
async def test_unobserved_and_ambiguous_requests_do_not_fetch_tracks():
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'alt_baro':36000,'seen_pos':0}, NOW, NOW, 'live', True)
    calls = []

    def respond(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={'flights':[flight(), flight(fa_flight_id='different-leg')]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        service = JourneyService(client, 'private-test-key', JourneyCache(lambda: NOW), lambda: NOW)
        assert (await service.lookup('QTR8176', 'aa1234', NOW, None, None))['journey'] is None
        assert calls == []
        assert (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey'] is None
        assert (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey'] is None
        assert calls == ['/aeroapi/flights/QTR8176']


@pytest.mark.asyncio
async def test_diverted_original_never_becomes_actual_destination():
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'r':'A7-BFK', 'alt_baro':36000, 'seen_pos':0}, NOW, NOW, 'live', True)

    def respond(request):
        if request.url.path.endswith('/track'):
            return httpx.Response(404)
        return httpx.Response(200, json={'flights':[flight(diverted=True, actual_on=iso(NOW), origin=None)]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        service = JourneyService(client, 'private-test-key', JourneyCache(lambda: NOW), lambda: NOW)
        journey = (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey']
        assert journey['status'] == 'arrived'
        assert journey['origin'] is None and journey['destination'] is None
        assert journey['plannedDestination']['iata'] == 'SYD'
        assert journey['points'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('failed_refresh', ['limit', 'timeout'])
async def test_pinned_refresh_keeps_confirmed_journey_and_explains_failure(failed_refresh):
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    clock = [NOW]
    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'r':'A7-BFK', 'alt_baro':36000, 'seen_pos':0}, NOW, NOW, 'live', True)

    def respond(request):
        if clock[0] > NOW:
            assert failed_refresh != 'limit'
            raise httpx.ReadTimeout('simulated upstream timeout')
        data = {'positions':[]} if request.url.path.endswith('/track') else {'flights':[flight()]}
        return httpx.Response(200, json=data)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        cache = JourneyCache(lambda: clock[0])
        service = JourneyService(client, 'private-test-key', cache, lambda: clock[0])
        journey = (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey']
        clock[0] += 180
        if failed_refresh == 'limit':
            for _ in range(4):
                await cache.reserve()
        reply = await service.lookup('QTR8176', 'aa1234', NOW, journey['id'], None)
        assert reply['journey'] == journey
        assert reply['retryable'] is True
        assert ('limit' if failed_refresh == 'limit' else 'temporarily unavailable') in reply['reason']


@pytest.mark.asyncio
async def test_arrival_without_new_track_preserves_last_track_and_settles_once():
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    clock = [NOW]
    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'r':'A7-BFK', 'alt_baro':36000, 'seen_pos':0}, NOW, NOW, 'live', True)

    def respond(request):
        if request.url.path.endswith('/track'):
            return (httpx.Response(200, json={'positions':[point(NOW, 1.35, 103.9, 360)]}) if clock[0] == NOW else
                httpx.Response(404) if clock[0] < NOW+300 else httpx.Response(200, json={'positions':[]}))
        changes = {'actual_on':iso(NOW+120)} if clock[0] > NOW else {}
        return httpx.Response(200, json={'flights':[flight(**changes)]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        service = JourneyService(client, 'private-test-key', JourneyCache(lambda: clock[0]), lambda: clock[0])
        first = (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey']
        clock[0] += 180
        provisional = await service.lookup('QTR8176', 'aa1234', NOW, first['id'], None)
        assert provisional['journey']['status'] == 'arrived'
        assert provisional['journey']['points'] == first['points']
        assert 'last confirmed track' in provisional['reason']
        assert provisional['retryable'] is True
        clock[0] += 180
        final = await service.lookup('QTR8176', 'aa1234', NOW, first['id'], None)
        assert final['journey'] == provisional['journey']
        assert 'last confirmed track' in final['reason']
        assert not final.get('retryable')


@pytest.mark.asyncio
@pytest.mark.parametrize('revocation', ['record', 'status'])
async def test_explicitly_blocked_or_revoked_track_never_returns_cached_data(revocation):
    from backend.app.journey import JourneyCache, JourneyService
    from backend.app.normalize import normalize_record

    clock = [NOW]
    observed = normalize_record({'hex':'aa1234', 'flight':'QTR8176', 'lat':1.35, 'lon':103.9,
        'r':'A7-BFK', 'alt_baro':36000, 'seen_pos':0}, NOW, NOW, 'live', True)

    def respond(request):
        if clock[0] > NOW and revocation == 'status':
            return httpx.Response(403)
        if request.url.path.endswith('/track'):
            assert clock[0] == NOW
            return httpx.Response(200, json={'positions':[point(NOW, 1.35, 103.9, 360)]})
        return httpx.Response(200, json={'flights':[flight(blocked=clock[0]>NOW)]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        service = JourneyService(client, 'private-test-key', JourneyCache(lambda: clock[0]), lambda: clock[0])
        first = (await service.lookup('QTR8176', 'aa1234', NOW, None, observed))['journey']
        clock[0] += 180
        refreshed = await service.lookup('QTR8176', 'aa1234', NOW, first['id'], None)
        assert refreshed['journey'] is None and not refreshed.get('retryable')
        assert (await service.lookup('QTR8176', 'aa1234', NOW, first['id'], None))['journey'] is None

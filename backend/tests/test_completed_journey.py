from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.cloud import create_cloud_app
from backend.app.config import Settings
from backend.app.main import create_app


def timestamp(value):
    return int(datetime.fromisoformat(value).timestamp())


NOW = timestamp('2026-11-28T10:00:00+00:00')
START = timestamp('2026-11-26T23:55:00+00:00')
MIDNIGHT = timestamp('2026-11-27T00:00:00+00:00')
END = timestamp('2026-11-27T02:05:00+00:00')
PARAMS = {'callsign':'SIA638', 'date':'2026-11-26'}
PATH = '/api/journey/completed'
KEY = 'test-archive-secret'


def leg(**overrides):
    return {'icao':'76cc7a', 'r':'9V-SCZ', 'callsign':'SIA638', 'day':'2026-11-26',
        'first_seen':START, 'last_seen':END,
        'from':{'airport':'WSSS', 'iata':'SIN', 'time':START, 'name':'Singapore Changi Airport', 'seen':'low'},
        'to':{'airport':'RJAA', 'iata':'NRT', 'time':END, 'name':'Narita International Airport', 'seen':'low'}, **overrides}


def flights(*rows, missing=()):
    return {'callsign':'SIA638', 'days':7, 'coverage':{'from':'2026-11-21', 'to':'2026-11-27', 'missing':list(missing)},
        'count':len(rows), 'flights':list(rows), 'usual':[{'from':{'airport':'WSSS'}, 'to':{'airport':'RJAA'}}]}


def trace(timestamp, *points, icao='76cc7a'):
    return {'icao':icao, 'timestamp':timestamp, 'trace':list(points)}


def make_client(monkeypatch, transport, clock=lambda: NOW, settings=None):
    factory = httpx.AsyncClient
    monkeypatch.setattr('backend.app.main.httpx.AsyncClient',
        lambda **kwargs: factory(transport=httpx.MockTransport(transport), **kwargs))
    return TestClient(create_app(settings or Settings(flyitaly_enabled=True, flyitaly_api_key=KEY), clock=clock))


def test_completed_journey_uses_both_utc_traces_and_only_points_in_the_leg(monkeypatch):
    requests = []

    def upstream(request):
        assert request.url.host == 'api.flyitalyadsb.com'
        assert request.headers['x-api-key'] == KEY
        requests.append(request.url.path)
        if request.url.path == '/v2/flights/callsign/SIA638':
            assert list(request.url.params.multi_items()) == [('days', '7')]
            return httpx.Response(200, json=flights(leg(), leg(day='2026-11-25')))
        if request.url.path == '/v2/history/76cc7a/2026-11-26':
            return httpx.Response(200, json=trace(START-10,
                [0,1,100,12000,0,0,0], [10,1.36,104,'ground',0,0,2], [69.125,2,105,37000,0,0,0]))
        assert request.url.path == '/v2/history/76cc7a/2026-11-27'
        return httpx.Response(200, json=trace(MIDNIGHT,
            [5,4,107,None,0,0,1], [5,4,107,32000,0,0,0],
            [20,5,108,None,0,0,0], [END-MIDNIGHT,35.7,140.4,0,0,0,0],
            [END-MIDNIGHT+10,34,141,12000,0,0,0], [21,100,108,8000,0,0,0]))

    with make_client(monkeypatch, upstream) as client:
        response = client.get(PATH, params={**PARAMS, 'callsign':' sia638 '})
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        body = response.json()
        journey = body['journey']
        assert journey['callsign'] == 'SIA638'
        assert journey['source'] == 'FlyItalyADSB'
        assert journey['status'] == 'completed'
        assert journey['origin']['iata'] == 'SIN'
        assert journey['destination']['icao'] == 'RJAA'
        assert (journey['departureTime'], journey['arrivalTime']) == (START, END)
        assert [(point['time'], point['altitude_ft']) for point in journey['points']] == [
            (START,0), (START+59.125,37000), (MIDNIGHT+5,32000), (MIDNIGHT+20,None), (END,0)]
        assert all(not point['estimated'] for point in journey['points'])
        assert journey['points'][2]['gapBefore'] is True
        assert KEY not in response.text
        assert client.get(PATH, params=PARAMS).json() == body
        assert client.get(PATH, params={**PARAMS, 'date':'2026-11-27'}).json()['journey'] is None
    assert requests == ['/v2/flights/callsign/SIA638', '/v2/history/76cc7a/2026-11-26', '/v2/history/76cc7a/2026-11-27']


def test_completed_journey_exposes_partial_coverage_without_inventing_an_airport(monkeypatch):
    def upstream(request):
        if '/flights/' in request.url.path:
            return httpx.Response(200, json=flights(leg(to=None)))
        if request.url.path.endswith('2026-11-26'):
            return httpx.Response(200, json=trace(START, [0,1.36,104,1000]))
        return httpx.Response(404, json={'error':'no track'})

    with make_client(monkeypatch, upstream) as client:
        result = client.get(PATH, params=PARAMS).json()
    journey = result['journey']
    assert journey['origin']['icao'] == 'WSSS'
    assert journey['destination'] is None and journey['arrivalTime'] is None
    assert [point['time'] for point in journey['points']] == [START]
    assert 'arrival' in result['reason'] and 'track' in result['reason']


def test_completed_journey_keeps_available_trace_after_one_utc_day_fails(monkeypatch):
    def upstream(request):
        if '/flights/' in request.url.path:
            return httpx.Response(200, json=flights(leg()))
        if request.url.path.endswith('2026-11-26'):
            return httpx.Response(503, json={'error':KEY})
        return httpx.Response(200, json=trace(MIDNIGHT, [END-MIDNIGHT,35.7,140.4,100]))

    with make_client(monkeypatch, upstream) as client:
        response = client.get(PATH, params=PARAMS)
    result = response.json()
    assert KEY not in response.text
    assert result['retryable'] is True and 'track' in result['reason']
    assert [point['time'] for point in result['journey']['points']] == [END]


@pytest.mark.parametrize('rows,missing,reason,retryable', [
    ([], (), 'No matching', False),
    ([leg(callsign='SIA639')], (), 'No matching', False),
    ([leg(), leg(icao='76cc7b')], (), 'More than one', False),
    ([], ('2026-11-26',), 'coverage', True),
])
def test_completed_journey_does_not_guess_a_missing_or_ambiguous_leg(monkeypatch, rows, missing, reason, retryable):
    def upstream(request):
        assert request.url.path == '/v2/flights/callsign/SIA638'
        return httpx.Response(200, json=flights(*rows, missing=missing))

    with make_client(monkeypatch, upstream) as client:
        result = client.get(PATH, params=PARAMS).json()
    assert result['journey'] is None and reason in result['reason']
    assert result.get('retryable', False) is retryable


@pytest.mark.parametrize('query', [
    'callsign=SIA638&date=2026-11-20', 'callsign=SIA638&date=2026-11-28', 'callsign=SIA638&date=2026-02-30',
    'callsign=SIA638&date=20261126', 'callsign=SIA638&date=2026-11-26&date=2026-11-27',
    'callsign=%2Fetc&date=2026-11-26', 'callsign=SIA638&date=2026-11-26&hex=76cc7a',
])
def test_completed_journey_validates_query_without_upstream_io(monkeypatch, query):
    def unexpected(request):
        pytest.fail('Invalid input reached the provider')

    with make_client(monkeypatch, unexpected) as client:
        response = client.get(PATH + '?' + query)
    assert response.status_code == 200
    assert response.json()['journey'] is None
    assert response.json()['reason']


@pytest.mark.parametrize('factory', [create_app, create_cloud_app])
def test_completed_journey_needs_existing_flyitaly_configuration(factory):
    with TestClient(factory(Settings(flyitaly_api_key=KEY))) as client:
        response = client.get(PATH, params=PARAMS)
    assert response.status_code == 200
    assert response.json()['journey'] is None
    assert 'unavailable' in response.json()['reason']
    assert KEY not in response.text


def test_hosted_completed_journey_fails_closed_without_shared_cache(monkeypatch):
    for key in ('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'):
        monkeypatch.delenv(key, raising=False)
    with TestClient(create_cloud_app(Settings(flyitaly_enabled=True, flyitaly_api_key=KEY))) as client:
        response = client.get(PATH, params={**PARAMS, 'date':(datetime.now(timezone.utc).date()-timedelta(days=2)).isoformat()})
    assert response.status_code == 200
    assert response.json()['journey'] is None
    assert response.json()['retryable'] is True


def test_completed_journey_limits_provider_requests_across_callsigns(monkeypatch):
    calls = []
    clock = [NOW]

    def upstream(request):
        calls.append(request.url.path)
        return httpx.Response(200, json=flights())

    with make_client(monkeypatch, upstream, clock=lambda: clock[0]) as client:
        for index in range(6):
            assert 'No matching' in client.get(PATH, params={**PARAMS, 'callsign':f'SIA{index}'}).json()['reason']
        limited = client.get(PATH, params={**PARAMS, 'callsign':'SIA6'}).json()
        assert limited['retryable'] is True and 'limit' in limited['reason']
        assert len(calls) == 6
        clock[0] += 121
        assert 'No matching' in client.get(PATH, params={**PARAMS, 'callsign':'SIA6'}).json()['reason']
    assert len(calls) == 7

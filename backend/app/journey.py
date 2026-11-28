"""On-demand FlightAware v4 journeys for aircraft observed by the tracker."""
import asyncio
from collections import OrderedDict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import re
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from geographiclib.geodesic import Geodesic
import httpx

from .cloud_cache import CacheLimited, CacheUnavailable
from .contracts import Observation, Track

BASE_URL = 'https://aeroapi.flightaware.com/aeroapi'
DISABLED = 'Confirmed journeys are unavailable on this server.'
NO_OBSERVATION = 'A recent Singapore position is needed to confirm this flight.'
NO_MATCH = 'FlightAware could not confirm a matching flight leg.'
UNAVAILABLE = 'Confirmed journeys are temporarily unavailable.'
LIMITED = 'Confirmed journey lookups have reached their current limit.'
WITHHELD = 'FlightAware does not make this journey available.'
REFRESH_SECONDS = 120
PIN_SECONDS = 48 * 3600
BODY_LIMIT = 8_000_000
CALLSIGN = re.compile(r'[A-Z0-9][A-Z0-9-]{0,11}')
HEX = re.compile(r'[a-f0-9]{6}')
FLIGHT_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9:_-]{0,109}')
JOURNEY_BUDGET = 'changi:journey:budget'
RESERVE = """
local t = redis.call('TIME')
local ms = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000)
if redis.call('EXISTS', KEYS[1] .. ':denied') == 1 then return -1 end
if redis.call('EXISTS', KEYS[1] .. ':pause') == 1 then return 0 end
local day = KEYS[1] .. ':day:' .. math.floor(tonumber(t[1])/86400)
local recent = KEYS[1] .. ':recent'
redis.call('ZREMRANGEBYSCORE', recent, '-inf', ms-1000)
if redis.call('ZCARD', recent) >= 4 or tonumber(redis.call('GET', day) or '0') >= tonumber(ARGV[2]) then return 0 end
if redis.call('INCR', day) == 1 then redis.call('EXPIRE', day, 86400) end
redis.call('ZADD', recent, ms, ARGV[1])
redis.call('EXPIRE', recent, 2)
return 1
"""


class JourneyCache:
    def __init__(self, clock=time.time, redis=None, api_key='', daily_limit=100):
        self.clock = clock
        self.redis = redis
        self.scope = hmac.digest(api_key.encode(), b'changi-journey-cache:v1', hashlib.sha256).hex()[:24]
        self.budget_key = f'{JOURNEY_BUDGET}:{self.scope}'
        self.daily_limit = daily_limit
        self.entries = OrderedDict()
        self.recent = deque()
        self.day = None
        self.requests = 0
        self.paused_until = 0

    def key(self, key):
        if key == 'access-denied':
            return self.budget_key + ':denied'
        return f'{self.redis.prefix}:journey:{self.scope}:{key}'

    async def get(self, key):
        if self.redis is not None:
            return self.redis.decode(await self.redis.command('GET', self.key(key)))
        until, value = self.entries.get(key, (0, None))
        if self.clock() >= until:
            self.entries.pop(key, None)
            return None
        self.entries.move_to_end(key)
        return value

    async def put(self, key, value, ttl):
        if self.redis is not None:
            await self.redis.command('SET', self.key(key), self.redis.encode(value), 'EX', ttl)
            return
        self.entries[key] = (self.clock() + ttl, value)
        self.entries.move_to_end(key)
        if len(self.entries) > 256:
            self.entries.popitem(last=False)

    async def claim(self, key):
        key = 'lease:' + key
        if self.redis is not None:
            return await self.redis.command('SET', self.key(key), '1', 'NX', 'EX', REFRESH_SECONDS) == 'OK'
        if await self.get(key) is not None:
            return False
        await self.put(key, True, REFRESH_SECONDS)
        return True

    async def reserve(self):
        if self.redis is not None:
            result = await self.redis.command('EVAL', RESERVE, 1, self.budget_key, uuid.uuid4().hex, self.daily_limit)
            if result == -1:
                raise AeroAccessDenied()
            if result != 1:
                raise CacheLimited()
            return
        if await self.get('access-denied'):
            raise AeroAccessDenied()
        now = self.clock()
        day = int(now // 86400)
        if day != self.day:
            self.day, self.requests = day, 0
        while self.recent and self.recent[0] <= now - 1:
            self.recent.popleft()
        if now < self.paused_until or len(self.recent) >= 4 or self.requests >= self.daily_limit:
            raise CacheLimited()
        self.requests += 1
        self.recent.append(now)

    async def pause(self, seconds):
        if self.redis is not None:
            await self.redis.command('SET', self.budget_key + ':pause', '1', 'EX', seconds)
        else:
            self.paused_until = max(self.paused_until, self.clock() + seconds)


def empty(reason, retryable=False):
    return {'journey':None, 'reason':reason, **({'retryable':True} if retryable else {})}


class AeroAccessDenied(Exception):
    pass


class AeroFlightWithheld(Exception):
    pass


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return int(parsed.timestamp()) if parsed.utcoffset() is not None else None
    except (ValueError, OverflowError, OSError):
        return None


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='seconds')


def label(value):
    return value.strip()[:200] or None if isinstance(value, str) else None


def coordinate(value, maximum):
    return float(value) if type(value) in (int, float) and -maximum <= value <= maximum else None


def airport(value, position_only):
    if not isinstance(value, dict):
        return None
    icao, iata = label(value.get('code_icao')), label(value.get('code_iata'))
    if not (icao or iata) and (position_only or not value.get('airport_info_url')):
        return None
    return {'icao':icao, 'iata':iata, 'name':label(value.get('name')), 'city':label(value.get('city')),
        'lat':coordinate(value.get('latitude'), 90), 'lon':coordinate(value.get('longitude'), 180)}


@dataclass(frozen=True)
class Flight:
    id: str
    registration: str | None
    departure: int | None
    arrival: int | None
    expected_arrival: int | None
    origin: dict | None
    destination: dict | None
    diverted: bool


def matching_flights(payload, callsign, observed_at, evidence, pinned):
    flights = payload.get('flights')
    links = payload.get('links')
    if not isinstance(flights, list) or (links is not None and (not isinstance(links, dict) or links.get('next'))):
        return []
    candidates = {}
    for row in flights:
        if not isinstance(row, dict) or row.get('blocked') is True or row.get('cancelled') is True:
            continue
        flight_id = row.get('fa_flight_id')
        if not isinstance(flight_id, str) or not FLIGHT_ID.fullmatch(flight_id) or (pinned and pinned != flight_id):
            continue
        identifiers = (row.get(key) for key in ('atc_ident', 'ident_icao', 'ident', 'ident_iata', 'registration'))
        if callsign not in {normalized_callsign(value) for value in identifiers if isinstance(value, str)}:
            continue
        registration = label(row.get('registration'))
        if evidence and evidence.registration and registration and normalized_registration(registration) != normalized_registration(evidence.registration):
            continue
        departure = instant(row.get('actual_off'))
        gate_departure = instant(row.get('actual_out'))
        arrival = instant(row.get('actual_on')) or instant(row.get('actual_in'))
        start = ((gate_departure or departure) if evidence and evidence.ground is True else departure or gate_departure)
        start = start or instant(row.get('estimated_off')) or instant(row.get('scheduled_off'))
        end = (instant(row.get('actual_in')) or arrival) if evidence and evidence.ground is True else arrival
        if not pinned and ((start is not None and not observed_at - 26 * 3600 <= start <= observed_at + 120)
                or (end is not None and observed_at > end + 120)):
            continue
        position_only = row.get('position_only') is True
        candidate = Flight(flight_id, registration, departure, arrival, instant(row.get('estimated_on')),
            airport(row.get('origin'), position_only),
            airport(row.get('destination'), position_only) if arrival or not position_only else None,
            row.get('diverted') is True)
        candidates.setdefault(flight_id, []).append(candidate)
    return next(iter(candidates.values())) if len(candidates) == 1 else []


def is_withheld(payload, flight_id):
    rows = payload.get('flights')
    return isinstance(rows, list) and any(isinstance(row, dict) and row.get('fa_flight_id') == flight_id
        and row.get('blocked') is True for row in rows)


def track_points(payload, now):
    positions = payload.get('positions')
    if not isinstance(positions, list):
        return []
    samples = {}
    for row in positions:
        if not isinstance(row, dict):
            continue
        timestamp = instant(row.get('timestamp'))
        lat, lon = coordinate(row.get('latitude'), 90), coordinate(row.get('longitude'), 180)
        if lat is None or lon is None or timestamp is None or not 0 < timestamp <= now:
            continue
        altitude = row.get('altitude')
        point = {'time':timestamp, 'lat':lat, 'lon':lon,
            'altitude_ft':altitude * 100 if type(altitude) is int and -100 <= altitude <= 2500 else None,
            'estimated':row.get('update_type') == 'P'}
        previous = samples.get(timestamp)
        if previous is None or (point['estimated'],point['altitude_ft'] is None) < (previous['estimated'],previous['altitude_ft'] is None):
            samples[timestamp] = point
    return sorted(samples.values(), key=lambda point: point['time'])


def normalized_registration(value):
    return value.replace('-', '').strip().upper()


def normalized_callsign(value):
    return ''.join(value.split()).upper()


def distance(evidence, lat, lon):
    return Geodesic.WGS84.Inverse(evidence.lat, evidence.lon, lat, lon)['s12']


def corroborates(flights, points, evidence):
    if evidence.registration and any(flight.departure is not None and flight.registration
            and (flight.arrival is not None or flight.expected_arrival is None
                 or evidence.position_time <= flight.expected_arrival + 7200)
            and normalized_registration(flight.registration) == normalized_registration(evidence.registration)
            for flight in flights):
        return True
    return any(not point['estimated'] and abs(point['time'] - evidence.position_time) <= 120
        and distance(evidence, point['lat'], point['lon']) <= 15000
        for point in points)


def alias_matches(alias, evidence, journey):
    elapsed = abs(evidence.position_time - alias['time'])
    if elapsed > 180 or distance(evidence, alias['lat'], alias['lon']) > 1500 + elapsed * 400:
        return False
    if alias['registration'] and evidence.registration and alias['registration'] != normalized_registration(evidence.registration):
        return False
    arrived = journey['arrivalTime']
    return arrived is None or evidence.position_time <= arrived or (
        evidence.ground is True and evidence.position_time <= arrived + 120)


def same_airport(left, right):
    return any(left.get(code) and left[code] == right.get(code) for code in ('icao', 'iata')) or left == right


def unique_airport(airports):
    values = [value for value in airports if value is not None]
    return values[0] if values and all(same_airport(values[0], value) for value in values) else None


def render_journey(flights, points, callsign, now):
    landed = [flight for flight in flights if flight.arrival is not None and flight.arrival <= now]
    current = [flight for flight in flights if not flight.diverted]
    origin = unique_airport(flight.origin for flight in flights)
    intended = unique_airport(flight.destination for flight in current)
    planned = unique_airport(flight.destination for flight in flights if flight.diverted)
    destination = unique_airport(flight.destination for flight in landed if not flight.diverted) if landed else intended
    departure = [flight.departure for flight in flights if flight.departure is not None and flight.departure <= now]
    result = {'id':flights[0].id, 'callsign':callsign, 'status':'arrived' if landed else 'airborne',
        'origin':origin, 'destination':destination, 'source':'FlightAware AeroAPI', 'points':points,
        'departureTime':min(departure, default=None), 'arrivalTime':max((flight.arrival for flight in landed), default=None)}
    if planned and (destination is None or not same_airport(planned, destination)):
        result['plannedDestination'] = planned
    return result


def settlement_pending(journey, newest_points, prior, now):
    if journey['status'] != 'arrived':
        return False
    if prior and prior['status'] == 'arrived':
        return prior.get('settlement_pending', False) and now - prior['updated'] < REFRESH_SECONDS
    arrival = journey['arrivalTime']
    latest_observed = max((point['time'] for point in newest_points if not point['estimated']), default=0)
    return now - arrival < 600 or latest_observed < arrival - 300


class JourneyService:
    def __init__(self, client, api_key, cache, clock=time.time):
        self.client, self.api_key, self.cache, self.clock = client, api_key, cache, clock

    def bookmark(self, flight_id, callsign, hex_id, observed_at):
        message = f'changi-journey:v1:{flight_id}|{callsign}|{hex_id}|{observed_at}'.encode()
        signature = hmac.digest(self.api_key.encode(), message, hashlib.sha256).hex()
        return f'{flight_id}~{signature}'

    def response(self, journey, callsign, hex_id, observed_at, stale_reason=None):
        result = {key:value for key,value in journey.items() if key not in ('updated', 'settlement_pending', 'coverage_notice')}
        result.update(callsign=callsign, id=self.bookmark(journey['id'], callsign, hex_id, observed_at))
        reply = {'journey':result}
        if stale_reason:
            reply.update(reason=stale_reason + ' Showing the last confirmed track.', retryable=True)
        else:
            if journey.get('coverage_notice'):
                reply['reason'] = journey['coverage_notice']
            if journey.get('settlement_pending'):
                reply['retryable'] = True
        return reply

    async def fetch(self, path, **params):
        await self.cache.reserve()
        async with asyncio.timeout(8):
            async with self.client.stream('GET', BASE_URL + path, params=params,
                    headers={'x-apikey':self.api_key}, follow_redirects=False) as response:
                if response.status_code in (401, 403):
                    raise AeroAccessDenied()
                if response.status_code == 400:
                    raise AeroFlightWithheld()
                if response.status_code == 429:
                    retry = response.headers.get('Retry-After', '')[:10]
                    await self.cache.pause(min(86400, max(60, int(retry) if retry.isdecimal() and retry.isascii() else 60)))
                    raise CacheLimited()
                if response.status_code == 404:
                    return {}
                response.raise_for_status()
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > BODY_LIMIT:
                        raise ValueError('AeroAPI response is too large')
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError('AeroAPI response is not an object')
        return body

    async def lookup(self, callsign, hex_id, observed_at, bookmark, evidence: Observation | None):
        now = self.clock()
        flight_id = None
        if bookmark:
            flight_id, _, _ = bookmark.partition('~')
            if (not FLIGHT_ID.fullmatch(flight_id) or not bookmark.isascii() or not 0 <= now - observed_at <= PIN_SECONDS
                    or not hmac.compare_digest(bookmark, self.bookmark(flight_id, callsign, hex_id, observed_at))):
                return empty(NO_MATCH)
        elif (evidence is None or evidence.position_time is None or int(evidence.position_time) != observed_at
                or not 0 <= now - observed_at <= 180):
            return empty(NO_OBSERVATION, retryable=True)

        stale = None
        matched_id = flight_id
        def unavailable(reason):
            if stale:
                return self.response(stale, callsign, hex_id, observed_at, reason)
            return empty(reason, retryable=True)

        try:
            if await self.cache.get('access-denied'):
                return empty(DISABLED)
            if flight_id is None:
                key = f'lookup:{hex_id}:{callsign}'
                alias = await self.cache.get(key)
                if alias and alias.get('id'):
                    saved = await self.cache.get('flight:' + alias['id'])
                    if saved and saved.get('withheld'):
                        return empty(WITHHELD)
                    if saved and alias_matches(alias, evidence, saved):
                        return self.response(saved, callsign, hex_id, observed_at)
                elif alias:
                    return empty(NO_MATCH, retryable=True)
            else:
                key = 'flight:' + flight_id
                stale = await self.cache.get(key)
                if stale:
                    if stale.get('withheld'):
                        return empty(WITHHELD)
                    refresh_after = 1800 if stale['status'] == 'arrived' and not stale.get('settlement_pending') else REFRESH_SECONDS
                    if now - stale['updated'] < refresh_after:
                        return self.response(stale, callsign, hex_id, observed_at)

            if not await self.cache.claim(key):
                return unavailable(UNAVAILABLE)

            params = {'max_pages':1}
            if flight_id is not None:
                params['ident_type'] = 'fa_flight_id'
            else:
                params.update(start=iso(observed_at - 26 * 3600), end=iso(observed_at + 2 * 3600))
            payload = await self.fetch(f'/flights/{flight_id or callsign}', **params)
            if flight_id and is_withheld(payload, flight_id):
                raise AeroFlightWithheld()
            flights = matching_flights(payload, callsign, observed_at, evidence, flight_id)
            if flights:
                matched_id = flights[0].id
                if is_withheld(payload, matched_id):
                    raise AeroFlightWithheld()
                started = any(row.departure is not None and row.departure <= now or row.arrival is not None and row.arrival <= now for row in flights)
                if started or evidence is not None and evidence.ground is False:
                    track = await self.fetch(f'/flights/{matched_id}/track', include_estimated_positions='true')
                    points = track_points(track, now)
                    if flight_id or corroborates(flights, points, evidence):
                        prior = stale if flight_id else await self.cache.get('flight:' + matched_id)
                        if prior and prior.get('withheld'):
                            return empty(WITHHELD)
                        previous_points = prior['points'] if prior else []
                        journey = render_journey(flights, points or previous_points, callsign, now)
                        if prior and prior['status'] == 'arrived' and journey['status'] == 'airborne':
                            return self.response(prior, callsign, hex_id, observed_at, UNAVAILABLE)
                        journey['settlement_pending'] = settlement_pending(journey, points, prior, now)
                        if not points:
                            journey['coverage_notice'] = ('FlightAware returned no updated positions. Showing the last confirmed track.'
                                if previous_points else 'FlightAware has no track positions for this leg.')
                        await self.cache.put('flight:' + matched_id, {**journey, 'updated':now}, PIN_SECONDS)
                        if flight_id is None:
                            registrations = {normalized_registration(row.registration) for row in flights if row.registration}
                            registration = (normalized_registration(evidence.registration) if evidence.registration else
                                next(iter(registrations)) if len(registrations) == 1 else None)
                            await self.cache.put(key, {'id':matched_id, 'registration':registration,
                                'time':evidence.position_time, 'lat':evidence.lat, 'lon':evidence.lon}, REFRESH_SECONDS)
                        return self.response(journey, callsign, hex_id, observed_at)
            if flight_id is None:
                await self.cache.put(key, {'id':None}, REFRESH_SECONDS)
            return unavailable(NO_MATCH)
        except AeroAccessDenied:
            try:
                await self.cache.put('access-denied', {'denied':True}, 900)
            except CacheUnavailable:
                pass
            return empty(DISABLED)
        except AeroFlightWithheld:
            if matched_id:
                try:
                    await self.cache.put('flight:' + matched_id, {'withheld':True}, PIN_SECONDS)
                except CacheUnavailable:
                    pass
            return empty(WITHHELD)
        except CacheLimited:
            return unavailable(LIMITED)
        except (CacheUnavailable, httpx.HTTPError, TimeoutError, ValueError):
            return unavailable(UNAVAILABLE)


def find_observation(tracks: list[Track], callsign, hex_id, observed_at):
    for track in tracks:
        if track.latest.provider_id.lower() != hex_id:
            continue
        for point in (track.latest, *reversed(track.history)):
            if (normalized_callsign(point.callsign or '') == callsign and point.mode == 'live'
                    and point.position_time is not None and int(point.position_time) == observed_at):
                return point
    return None


async def journey_response(request: Request, settings, service, observed, clock=time.time):
    def response(data):
        return JSONResponse(data, headers={'Cache-Control':'no-store'})

    if not settings.aeroapi_enabled or not settings.aeroapi_api_key or settings.aeroapi_daily_request_limit <= 0 or service is None:
        return response(empty(DISABLED))
    params = request.query_params
    callsign = params.get('callsign', '').strip().upper()
    hex_id = params.get('hex', '').lower()
    timestamp = params.get('observed_at', '')
    bookmark = params.get('id')
    if (not CALLSIGN.fullmatch(callsign) or not HEX.fullmatch(hex_id) or not re.fullmatch(r'[0-9]{1,10}', timestamp)
            or (bookmark is not None and not 1 <= len(bookmark) <= 175)
            or any(key not in {'callsign','hex','observed_at','id'} or len(params.getlist(key)) != 1 for key in params)):
        return response(empty('A valid callsign, aircraft hex and observation time are required.'))
    observed_at = int(timestamp)
    try:
        async with asyncio.timeout(24):
            evidence = await observed(callsign, hex_id, observed_at) if not bookmark and 0 <= clock() - observed_at <= 180 else None
            result = await service.lookup(callsign, hex_id, observed_at, bookmark, evidence)
    except (CacheUnavailable, TimeoutError, ValueError):
        result = empty(UNAVAILABLE, retryable=True)
    return response(result)

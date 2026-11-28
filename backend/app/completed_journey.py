"""Dated journeys observed by FlyItalyADSB's receiver network."""
import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import re
import time

from fastapi import Request
from fastapi.responses import JSONResponse
import httpx

from .cloud_cache import CacheLimited, CacheUnavailable
from .journey import (CALLSIGN, HEX, REFRESH_SECONDS, JourneyAccessDenied, JourneyCache, coordinate, empty,
    label, normalized_callsign, read_journey_payload, retry_after_seconds)
from .normalize import number
from .provider import FLYITALY_API_URL

HISTORY_DAYS = 7
MAX_LEG_SECONDS = 26 * 3600
DISABLED = 'Completed journeys are unavailable on this server.'
UNAVAILABLE = 'FlyItalyADSB journey history is temporarily unavailable.'
LIMITED = 'Completed journey lookups have reached their current limit.'
DATE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}')
TRACE_STALE, TRACE_LEG_START = 1, 2
TRANSIENT_ERRORS = (httpx.HTTPError, TimeoutError, ValueError, OverflowError)


@dataclass(frozen=True)
class ObservedLeg:
    icao: str
    start: int
    end: int
    origin: dict | None
    departure: int | None
    destination: dict | None
    arrival: int | None


def utc_day(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).date()


def observed_endpoint(value, start, end):
    if not isinstance(value, dict):
        return None, None
    icao_code, iata_code, name = (label(value.get(key)) for key in ('airport', 'iata', 'name'))
    icao = icao_code if icao_code and re.fullmatch(r'[A-Z0-9]{4}', icao_code) else None
    iata = iata_code if iata_code and re.fullmatch(r'[A-Z0-9]{3}', iata_code) else None
    if not (icao or iata or name):
        return None, None
    timestamp = value.get('time')
    return {'icao':icao, 'iata':iata, 'name':name, 'city':None,
        'lat':coordinate(value.get('lat'), 90), 'lon':coordinate(value.get('lon'), 180)}, (
        timestamp if type(timestamp) is int and start <= timestamp <= end else None)


def observed_leg(row, day, now):
    icao = label(row.get('icao'))
    start, end = row.get('first_seen'), row.get('last_seen')
    if not icao or not HEX.fullmatch(icao.lower()) or type(start) is not int or type(end) is not int:
        raise ValueError('Invalid observed leg')
    if not 0 < start < end <= now or end - start > MAX_LEG_SECONDS or utc_day(start) != day:
        raise ValueError('Invalid observed leg times')
    origin, departure = observed_endpoint(row.get('from'), start, end)
    destination, arrival = observed_endpoint(row.get('to'), start, end)
    return ObservedLeg(icao.lower(), start, end, origin, departure, destination, arrival)


def trace_points(payload, leg, day):
    if payload is None:
        return []
    icao = label(payload.get('icao'))
    base, trace = number(payload.get('timestamp')), payload.get('trace')
    if not icao or icao.lower() != leg.icao or base is None or not isinstance(trace, list):
        raise ValueError('Invalid aircraft trace')
    midnight = datetime.combine(day, datetime.min.time(), timezone.utc).timestamp()
    points = {}
    for row in trace:
        if not isinstance(row, list) or len(row) < 4:
            continue
        offset, lat, lon = number(row[0]), coordinate(row[1], 90), coordinate(row[2], 180)
        if offset is None or offset < 0 or lat is None or lon is None:
            continue
        timestamp = round(base + offset, 3)
        if not (leg.start <= timestamp <= leg.end and midnight <= timestamp < midnight + 86400):
            continue
        altitude = 0 if row[3] == 'ground' else number(row[3])
        if altitude is not None and not -10000 <= altitude <= 250000:
            altitude = None
        flags = row[6] if len(row) > 6 and type(row[6]) is int else 0
        previous = points.get(timestamp)
        if previous is None or previous['altitude_ft'] is None and altitude is not None:
            points[timestamp] = {'time':timestamp, 'lat':lat, 'lon':lon, 'altitude_ft':altitude, 'estimated':False}
            if previous and previous.get('gapBefore'):
                points[timestamp]['gapBefore'] = True
        if flags & (TRACE_STALE | TRACE_LEG_START):
            points[timestamp]['gapBefore'] = True
    return sorted(points.values(), key=lambda point: point['time'])


class CompletedJourneyService:
    def __init__(self, client, api_key, clock=time.time, redis=None):
        self.client, self.api_key, self.clock = client, api_key, clock
        self.cache = JourneyCache(clock, redis, api_key, daily_limit=100, provider='flyitalyadsb', rate_limit=6, window_seconds=60)

    async def fetch(self, path, **params):
        await self.cache.reserve()
        async with asyncio.timeout(5):
            async with self.client.stream('GET', FLYITALY_API_URL + path, params=params,
                    headers={'X-Api-Key':self.api_key}, follow_redirects=False) as response:
                if response.status_code in (401, 403):
                    await self.cache.put('access-denied', {'denied':True}, 900)
                    raise JourneyAccessDenied()
                if response.status_code == 429:
                    await self.cache.pause(retry_after_seconds(response))
                    raise CacheLimited()
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return await read_journey_payload(response)

    async def flight_history(self, callsign, today):
        key = f'flights:{callsign}:{today}'
        cached = await self.cache.get(key)
        if cached is not None:
            return cached
        if not await self.cache.claim(key):
            return await self.cache.get(key)
        payload = await self.fetch(f'/flights/callsign/{callsign}', days=HISTORY_DAYS)
        if payload is None or not isinstance(payload.get('flights'), list) or not isinstance(payload.get('coverage'), dict):
            return None
        history = {'flights':payload['flights'], 'coverage':payload['coverage']}
        await self.cache.put(key, history, REFRESH_SECONDS)
        return history

    async def lookup(self, callsign, day, today):
        key = f'journey:{callsign}:{day}'
        try:
            cached = await self.cache.get(key)
            if cached is not None:
                return cached
            history = await self.flight_history(callsign, today)
            if history is None:
                return empty(UNAVAILABLE, retryable=True)
            coverage = history['coverage']
            lower, upper, missing = coverage.get('from'), coverage.get('to'), coverage.get('missing')
            day_text = day.isoformat()
            if (not isinstance(lower, str) or not isinstance(upper, str) or not isinstance(missing, list)
                    or not lower <= day_text <= upper or day_text in missing):
                return empty('FlyItalyADSB has no flight history coverage for this UTC date yet.', retryable=True)
            rows = [row for row in history['flights'] if isinstance(row, dict) and row.get('day') == day_text
                and isinstance(row.get('callsign'), str) and normalized_callsign(row['callsign']) == callsign]
            if not rows:
                return empty('No matching flight was observed by FlyItalyADSB on this UTC date.')
            if len(rows) != 1:
                return empty('More than one flight matches this callsign and UTC date.')
            leg = observed_leg(rows[0], day, self.clock())
            if not await self.cache.claim(key):
                return await self.cache.get(key) or empty(UNAVAILABLE, retryable=True)
            result, ttl = await self.journey(callsign, leg, day, today)
            await self.cache.put(key, result, ttl)
            return result
        except JourneyAccessDenied:
            return empty(DISABLED)
        except CacheLimited:
            return empty(LIMITED, retryable=True)
        except (CacheUnavailable, *TRANSIENT_ERRORS):
            return empty(UNAVAILABLE, retryable=True)

    async def journey(self, callsign, leg, day, today):
        points, notices = [], []
        track_incomplete = retryable = False
        end_day = utc_day(leg.end)
        for offset in range((end_day - day).days + 1):
            trace_day = day + timedelta(days=offset)
            try:
                payload = await self.fetch(f'/history/{leg.icao}/{trace_day}')
                samples = trace_points(payload, leg, trace_day)
            except (JourneyAccessDenied, CacheLimited):
                track_incomplete = retryable = True
                break
            except TRANSIENT_ERRORS:
                track_incomplete = retryable = True
                continue
            points.extend(samples)
            if not samples:
                track_incomplete = True
                retryable |= trace_day == today
        if leg.origin is None or leg.departure is None:
            notices.append('FlyItalyADSB did not observe the departure airport or time.')
        if leg.destination is None or leg.arrival is None:
            notices.append('FlyItalyADSB did not observe the arrival airport or time.')
        if track_incomplete:
            notices.append('Some track positions are unavailable.' if points else 'Track positions are unavailable.')
        result = {'journey':{'id':f'flyitaly:{callsign}:{leg.icao}:{leg.start}', 'callsign':callsign,
            'status':'completed', 'source':'FlyItalyADSB', 'origin':leg.origin, 'destination':leg.destination,
            'departureTime':leg.departure, 'arrivalTime':leg.arrival, 'points':points}}
        if notices:
            result['reason'] = ' '.join(notices)
        if retryable:
            result['retryable'] = True
        return result, REFRESH_SECONDS if retryable or end_day == today else 6 * 3600


async def completed_journey_response(request: Request, settings, service, clock=time.time):
    if not settings.flyitaly_enabled or not settings.flyitaly_api_key or service is None:
        result = empty(DISABLED)
    else:
        params = request.query_params
        callsign = params.get('callsign', '').strip().upper()
        raw_date = params.get('date', '')
        today = utc_day(clock())
        try:
            day = date.fromisoformat(raw_date) if DATE.fullmatch(raw_date) else None
        except ValueError:
            day = None
        if (day is None or not CALLSIGN.fullmatch(callsign)
                or any(key not in {'callsign', 'date'} or len(params.getlist(key)) != 1 for key in params)):
            result = empty('A valid callsign and UTC date (YYYY-MM-DD) are required.')
        elif not 1 <= (today - day).days <= HISTORY_DAYS:
            result = empty('Choose one of the seven previous UTC dates.')
        else:
            try:
                async with asyncio.timeout(24):
                    result = await service.lookup(callsign, day, today)
            except TimeoutError:
                result = empty(UNAVAILABLE, retryable=True)
    return JSONResponse(result, headers={'Cache-Control':'no-store'})

"""On-demand NEA surface weather; fixed feeds, shared leases, no collector."""
import asyncio
from dataclasses import dataclass
import hashlib
import json
import os
import time
import uuid
from email.utils import parsedate_to_datetime

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from .cloud_cache import RedisCache, CacheUnavailable

from copy import deepcopy
from datetime import datetime, timezone
import math
from urllib.parse import urlsplit

INTERVAL = {'wind': 60, 'radar': 300}
FRESH_AGE = {'wind': 600, 'radar': 900}
RADAR_HOST = 'dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com'
URLS = {
    'speed': 'https://api-open.data.gov.sg/v2/real-time/api/wind-speed',
    'direction': 'https://api-open.data.gov.sg/v2/real-time/api/wind-direction',
    'radar': 'https://api-open.data.gov.sg/v2/real-time/api/weather-radar-images/70km',
}


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Invalid weather measurement')
    return float(value)


def timestamp(value):
    if not isinstance(value, str): raise ValueError('Missing weather timestamp')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None: raise ValueError('Weather timestamp must include timezone')
    return parsed.timestamp()


def data_body(payload):
    if not isinstance(payload, dict) or payload.get('errorMsg') or not isinstance(payload.get('data'), dict):
        raise ValueError('Invalid weather response')
    return payload['data']


def envelope(layer, now, observed=None, message=None):
    return {'layer': layer, 'state': 'fresh' if observed is not None else 'unavailable',
            'observed_at': observed, 'fetched_at': now if observed is not None else None,
            'retry_after': INTERVAL[layer], 'message': message,
            **({'stations': []} if layer == 'wind' else {'radar': None})}


def image_url(value):
    if not isinstance(value, str) or len(value) > 16000: raise ValueError('Invalid radar URL')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname != RADAR_HOST or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.fragment or not parsed.path.endswith('.png')):
        raise ValueError('Unsupported radar image host')
    return value


def validate_frame(frame, now):
    """Redis is also a data boundary: corrupted state must not escape to clients."""
    try:
        layer = frame['layer']
        if layer not in INTERVAL or frame['state'] not in ('fresh', 'stale', 'unavailable'): raise ValueError()
        number(frame['retry_after'], 0, 315360000)
        if frame['message'] is not None and not isinstance(frame['message'], str): raise ValueError()
        if frame['observed_at'] is not None: number(frame['observed_at'], 0, now+60)
        if frame['fetched_at'] is not None: number(frame['fetched_at'], 0, now+60)
        if frame['state'] != 'unavailable' and (frame['observed_at'] is None or frame['fetched_at'] is None
                or not frame['stations' if layer == 'wind' else 'radar']):
            raise ValueError('Weather observations are missing')
        if layer == 'wind':
            if not isinstance(frame['stations'], list) or len(frame['stations']) > 1000: raise ValueError()
            for station in frame['stations']:
                if not isinstance(station['id'], str) or not isinstance(station['name'], str): raise ValueError()
                number(station['lat'], 1, 1.6); number(station['lon'], 103.5, 104.2)
                number(station['speed_mps'], 0, 103); number(station['from_deg'], 0, 360)
        elif frame['radar'] is not None:
            radar = frame['radar']; image_url(radar['url'])
            number(radar['west'], 103, 104); number(radar['east'], 104, 105)
            number(radar['north'], 1.5, 2.2); number(radar['south'], 0, 1)
            number(radar['expires_at'], 0, now+86400)
            if radar['observed_at'] != frame['observed_at']: raise ValueError()
    except (KeyError, TypeError, AttributeError):
        raise ValueError('Invalid cached weather') from None


def render(frame, now):
    validate_frame(frame, now)
    result = deepcopy(frame)
    layer = result['layer']; observed = result['observed_at']
    if observed is None: return result
    age = now - number(observed, 0, now + 60)
    if layer == 'radar' and (not result['radar'] or result['radar']['expires_at'] <= now):
        result.update(state='unavailable', radar=None, message='Radar image has expired')
    elif age > 1800:
        result.update(state='unavailable', message='Weather observations are too old')
        result.update({'stations': []} if layer == 'wind' else {'radar': None})
    elif age > FRESH_AGE[layer]:
        result.update(state='stale', message=result['message'] or 'Weather observations are delayed')
    return result


def wind_readings(data):
    result = {}
    for record in data['readings']:
        at = timestamp(record['timestamp'])
        readings = {}
        for reading in record['data']:
            station = reading['stationId']
            if station in readings: raise ValueError('Duplicate wind station')
            readings[station] = reading['value']
        result[at] = readings
    return result


def normalize_wind(speed, direction, now):
    try:
        speed, direction = data_body(speed), data_body(direction)
        if speed['readingUnit'].lower() != 'knots' or direction['readingUnit'].lower() != 'degrees':
            raise ValueError('Unsupported wind units')
        speeds, directions = wind_readings(speed), wind_readings(direction)
        common = speeds.keys() & directions.keys()
        if not common: raise ValueError('Wind readings do not share an observation time')
        observed = number(max(common), 0, now + 60)
        result = envelope('wind', now, observed)
        direction_stations = {s['id']: s for s in direction['stations']}
        seen = set()
        for station in speed['stations']:
            ident = station['id']
            if ident not in speeds[observed] or ident not in directions[observed] or ident not in direction_stations:
                continue
            try:
                if not isinstance(ident, str) or not ident or ident in seen: raise ValueError()
                lat = number(station['location']['latitude'], 1, 1.6)
                lon = number(station['location']['longitude'], 103.5, 104.2)
                other = direction_stations[ident]['location']
                if abs(number(other['latitude'], 1, 1.6)-lat) > .001 or abs(number(other['longitude'], 103.5, 104.2)-lon) > .001:
                    raise ValueError()
                name = station['name']
                if not isinstance(name, str) or not 0 < len(name) <= 160: raise ValueError()
                velocity = number(speeds[observed][ident], 0, 200) * 1852 / 3600
                bearing = number(directions[observed][ident], 0, 360) % 360
            except (ValueError, KeyError, TypeError):
                continue
            seen.add(ident)
            result['stations'].append({'id': ident, 'name': name, 'lat': lat, 'lon': lon,
                                       'speed_mps': velocity, 'from_deg': bearing})
        if not result['stations']: raise ValueError('No paired wind stations')
        return render(result, now)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ValueError('Invalid wind response') from None


def normalize_radar(payload, now):
    try:
        data = data_body(payload); bounds = data['boundaryBox']
        if bounds['crs'] != 'EPSG:4326': raise ValueError('Unsupported radar coordinates')
        west = number(bounds['upperLeft']['longitude'], 103, 104)
        north = number(bounds['upperLeft']['latitude'], 1.5, 2.2)
        east = number(bounds['lowerRight']['longitude'], 104, 105)
        south = number(bounds['lowerRight']['latitude'], 0, 1)
        if west >= east or south >= north: raise ValueError('Invalid radar bounds')
        record = max(data['records'], key=lambda r: timestamp(r['timestamp']))
        observed = number(timestamp(record['timestamp']), 0, now + 60)
        image = record['image']; url = image_url(image['url'])
        if image['range'] != '70km' or image['format'].lower() != 'png':
            raise ValueError('Unsupported radar image')
        expires = number(timestamp(image['urlExpiresAt']), now + 1, now + 86400)
        result = envelope('radar', now, observed)
        result['radar'] = {'url': url, 'west': west, 'south': south, 'east': east, 'north': north,
                           'observed_at': observed, 'expires_at': expires}
        return render(result, now)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ValueError('Invalid radar response') from None

# Budget at most 100k estimated Redis commands/month for weather, leaving 400k
# of the 500k free allowance for aircraft/location. Reserve 32 per admitted
# request, including EVAL plus internal commands and the worst-case publish.
# Exhausted-budget probes still cost TIME/GET/EVAL; this is not an account-wide
# billing cap. The existing aircraft feed has its own traffic limits.
MONTHLY_UNITS = 100_000
REQUEST_UNITS = 32
CLAIM = """
local now = tonumber(redis.call('TIME')[1])
if now < tonumber(ARGV[3]) or now >= tonumber(ARGV[4]) then return {'unavailable'} end
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
if used + 32 > 100000 then return {'limited', tostring(tonumber(ARGV[4])-now)} end
redis.call('INCRBY', KEYS[3], 32)
redis.call('EXPIREAT', KEYS[3], tonumber(ARGV[4])+86400)
local minute = math.floor(now / 60)
local viewer = KEYS[2] .. ':viewer:' .. ARGV[1] .. ':' .. minute
local m = redis.call('INCR', viewer)
if m == 1 then redis.call('EXPIRE', viewer, 120) end
if m > 4 then return {'limited', '60'} end
local global = KEYS[2] .. ':global:' .. minute
local n = redis.call('INCR', global)
if n == 1 then redis.call('EXPIRE', global, 120) end
if n > 20 then return {'limited', '60'} end
local payload = redis.call('GET', KEYS[1] .. ':data') or ''
if redis.call('EXISTS', KEYS[1] .. ':denied') == 1 then return {'cached', payload, '86400'} end
local retry = tonumber(redis.call('GET', KEYS[1] .. ':retry') or '0')
if retry > now then return {'cached', payload, tostring(retry-now)} end
local lease = redis.call('SET', KEYS[1] .. ':lease', ARGV[2], 'NX', 'EX', 35)
if not lease then return {'cached', payload, '5'} end
-- Reserve before provider I/O; an expired lease after a crash cannot repoll.
redis.call('SET', KEYS[1] .. ':retry', now+300, 'EX', 300)
return {'refresh', payload, '300'}
"""
PUBLISH = """
if redis.call('GET', KEYS[1] .. ':lease') ~= ARGV[1] then return 0 end
local now = tonumber(redis.call('TIME')[1])
redis.call('SET', KEYS[1] .. ':data', ARGV[2])
redis.call('SET', KEYS[1] .. ':retry', now+tonumber(ARGV[3]), 'EX', ARGV[3])
if ARGV[4] == '1' then redis.call('SET', KEYS[1] .. ':denied', '1') end
redis.call('DEL', KEYS[1] .. ':lease')
return 1
"""


class WeatherLimited(Exception):
    def __init__(self, retry_after=60): self.retry_after = retry_after


class WeatherUnavailable(Exception):
    def __init__(self, frame): self.frame = frame


@dataclass
class WeatherClaim:
    state: dict
    token: str | None
    retry_after: int


class WeatherCache(RedisCache):
    def __init__(self, client, url, secret, layer, prefix='changi:weather:v1'):
        super().__init__(client, url, secret, prefix + ':' + layer, rate_prefix=prefix)
        self.layer = layer

    @property
    def month_key(self):
        return self.rate_prefix + ':month:' + datetime.now(timezone.utc).strftime('%Y-%m')

    async def claim(self, viewer):
        now = datetime.now(timezone.utc)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(year=start.year+1, month=1) if start.month == 12 else start.replace(month=start.month+1)
        token = uuid.uuid4().hex
        digest = hashlib.sha256((self.secret+viewer).encode()).hexdigest()[:24]
        result = await self.command('EVAL', CLAIM, 3, self.prefix, self.rate_prefix,
                                    self.rate_prefix + ':month:' + start.strftime('%Y-%m'),
                                    digest, token, int(start.timestamp()), int(end.timestamp()))
        if not isinstance(result, list) or not result: raise CacheUnavailable()
        if result[0] == 'limited': raise WeatherLimited(int(result[1]))
        if result[0] not in ('refresh', 'cached') or len(result) != 3: raise CacheUnavailable()
        try:
            if len(result[1]) > 100_000: raise ValueError()
            state = json.loads(result[1]) if result[1] else {}
            if not isinstance(state, dict): raise ValueError()
            return WeatherClaim(state, token if result[0] == 'refresh' else None, max(1, int(result[2])))
        except (ValueError, TypeError): raise CacheUnavailable() from None

    async def publish(self, token, state, retry_after, denied=False):
        payload = json.dumps(state, allow_nan=False, separators=(',', ':'))
        if len(payload) > 100_000: raise CacheUnavailable()
        return await self.command('EVAL', PUBLISH, 1, self.prefix, token, payload,
                                   max(1, math.ceil(retry_after)), '1' if denied else '0') == 1


class ProviderFailure(Exception):
    def __init__(self, message, retry_after=None, denied=False):
        self.message, self.retry_after, self.denied = message, retry_after, denied


def retry_delay(value, now):
    if not value: return None
    try:
        return max(1, math.ceil(float(value)))
    except (ValueError, OverflowError):
        try: return max(1, math.ceil(parsedate_to_datetime(value).timestamp()-now))
        except (ValueError, TypeError, OverflowError): return None


class WeatherFeed:
    def __init__(self, cache, client, clock=time.time):
        self.cache, self.client, self.clock = cache, client, clock

    async def fetch(self, name):
        key = os.getenv('DATAGOV_API_KEY', '')
        try:
            response = await self.client.get(URLS[name], headers={'x-api-key': key} if key else {},
                                             timeout=8, follow_redirects=False)
            if response.status_code in (401, 403):
                raise ProviderFailure('Weather provider access denied; configuration needs attention', 86400, True)
            if response.status_code == 429 or response.status_code >= 500:
                raise ProviderFailure('Weather provider is temporarily unavailable',
                                      retry_delay(response.headers.get('Retry-After'), self.clock()))
            response.raise_for_status()
            if len(response.content) > 1_000_000: raise ValueError()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise ProviderFailure('Weather provider returned no usable observations') from None

    async def snapshot(self, viewer):
        layer = self.cache.layer
        claim = await self.cache.claim(viewer)
        previous = claim.state
        if not claim.token:
            frame = render(previous.get('frame') or envelope(layer, self.clock(), message='Weather update is pending'), self.clock())
            frame['retry_after'] = claim.retry_after
            if frame['state'] == 'unavailable': raise WeatherUnavailable(frame)
            return frame
        failures = previous.get('failures', 0)
        denied = False
        try:
            async with asyncio.timeout(18):
                if layer == 'wind':
                    speed = await self.fetch('speed')
                    direction = await self.fetch('direction')
                    frame = normalize_wind(speed, direction, self.clock())
                else:
                    frame = normalize_radar(await self.fetch('radar'), self.clock())
            retry = INTERVAL[layer]; failures = 0
        except (ProviderFailure, ValueError, TimeoutError) as error:
            failures = min(failures+1, 8)
            retry = min(3600, INTERVAL[layer] * 2 ** failures)
            message = 'Weather provider returned no usable observations'
            if isinstance(error, ProviderFailure):
                retry = max(retry, error.retry_after or 0)
                denied, message = error.denied, error.message
            frame = render(previous.get('frame') or envelope(layer, self.clock()), self.clock())
            if frame['state'] == 'fresh': frame['state'] = 'stale'
            frame['message'] = message
        frame['retry_after'] = retry
        if not await self.cache.publish(claim.token, {'frame': frame, 'failures': failures}, retry, denied):
            raise CacheUnavailable()
        if frame['state'] == 'unavailable': raise WeatherUnavailable(frame)
        return frame


router = APIRouter()


@router.get('/api/weather')
async def weather(request: Request):
    layer = request.query_params.get('layer')
    headers = {'Cache-Control': 'no-store'}
    if layer not in INTERVAL or len(request.query_params.getlist('layer')) != 1 or any(k != 'layer' for k in request.query_params):
        return JSONResponse({'error': 'Choose layer=wind or layer=radar'}, status_code=400, headers=headers)
    viewer = request.headers.get('x-vercel-forwarded-for') if os.getenv('VERCEL') else request.client.host if request.client else 'unknown'
    async with httpx.AsyncClient(follow_redirects=False) as client:
        cache = WeatherCache(client, os.getenv('KV_REST_API_URL', os.getenv('UPSTASH_REDIS_REST_URL', '')),
                             os.getenv('KV_REST_API_TOKEN', os.getenv('UPSTASH_REDIS_REST_TOKEN', '')), layer)
        try:
            frame = await WeatherFeed(cache, client).snapshot(viewer or 'unknown')
            return JSONResponse(frame, headers={**headers, 'X-Response-Time': str(time.time()),
                                                'Vercel-CDN-Cache-Control': 'public, s-maxage=15'})
        except WeatherLimited as error:
            frame = envelope(layer, time.time(), message='Weather request allowance reached; retry later')
            frame['retry_after'] = error.retry_after
            return JSONResponse(frame, status_code=429, headers={**headers, 'Retry-After': str(error.retry_after)})
        except WeatherUnavailable as error:
            return JSONResponse(error.frame, status_code=503, headers={**headers, 'Retry-After': str(error.frame['retry_after'])})
        except (CacheUnavailable, ValueError, KeyError, TypeError):
            frame = envelope(layer, time.time(), message='Shared weather cache is temporarily unavailable')
            frame['retry_after'] = 60
            return JSONResponse(frame, status_code=503, headers={**headers, 'Retry-After': '60'})

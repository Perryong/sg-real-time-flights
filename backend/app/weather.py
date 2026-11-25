"""On-demand observed radar/station and model surface weather; fixed feeds and shared leases."""
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
from datetime import datetime, timezone, timedelta
import math
from urllib.parse import urlsplit

INTERVAL = {'wind': 60, 'radar': 300, 'wind_regional': 900, 'radar_wide': 300, 'radar_history': 300}
FRESH_AGE = {'wind': 600, 'radar': 900, 'wind_regional': 1800, 'radar_wide': 900, 'radar_history': 600}
RADAR_HOST = 'dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com'
URLS = {
    'speed': 'https://api-open.data.gov.sg/v2/real-time/api/wind-speed',
    'direction': 'https://api-open.data.gov.sg/v2/real-time/api/wind-direction',
    'radar': 'https://api-open.data.gov.sg/v2/real-time/api/weather-radar-images/70km',
    'radar_wide': 'https://api-open.data.gov.sg/v2/real-time/api/weather-radar-images/480km',
    'wind_regional': 'https://api.open-meteo.com/v1/forecast',
}


# Same centre and radius as the Singapore aircraft region. A 125 km lattice
# clipped to the circle gives 49 fixed coordinates, conservatively 4,704
# location calls/day at the shared 900-second cadence (including crashes).
REGIONAL_CENTER = (1.3644, 103.9915)


def regional_grid():
    lat, lon = map(math.radians, REGIONAL_CENTER)
    points = []
    for north in range(-4, 5):
        for east in range(-4, 5):
            if north*north + east*east > 16: continue
            angle = math.hypot(north, east) * 125 / 6371
            bearing = math.atan2(east, north)
            target_lat = math.asin(math.sin(lat)*math.cos(angle) + math.cos(lat)*math.sin(angle)*math.cos(bearing))
            target_lon = lon + math.atan2(math.sin(bearing)*math.sin(angle)*math.cos(lat),
                                         math.cos(angle)-math.sin(lat)*math.sin(target_lat))
            points.append({'id': f'regional:{north}:{east}', 'lat': math.degrees(target_lat), 'lon': math.degrees(target_lon)})
    return tuple(points)


REGIONAL_GRID = regional_grid()
REGIONAL_BY_ID = {point['id']: point for point in REGIONAL_GRID}


def distance_km(lat, lon, origin=REGIONAL_CENTER):
    a, b = math.radians(lat), math.radians(origin[0])
    hav = math.sin((a-b)/2)**2 + math.cos(a)*math.cos(b)*math.sin(math.radians(lon-origin[1])/2)**2
    return 12742 * math.asin(math.sqrt(min(1, max(0, hav))))


def validate_model_position(lat, lon, requested):
    number(lat, -90, 90); number(lon, -180, 180)
    # Nearest model cells can differ from requested coordinates. Retain the
    # actual returned position, but reject distant or out-of-region cells.
    if distance_km(lat, lon) > 500.000001 or distance_km(lat, lon, (requested['lat'], requested['lon'])) > 30:
        raise ValueError('Model cell lies outside the requested region')


def history_window(now):
    end = math.floor(now / 300) * 300
    return {'window_start': end - 3600, 'window_end': end}


def empty_layer_data(layer, now=None):
    if layer == 'wind': return {'stations': []}
    if layer == 'wind_regional':
        return {'kind': 'model', 'source': 'Open-Meteo', 'height_m': 10, 'coverage_km': 500, 'points': []}
    if layer == 'radar_history':
        return {'range_km': 480, **history_window(now), 'frames': [], 'expected_frames': 13}
    return {'radar': None, **({'range_km': 480} if layer == 'radar_wide' else {})}


def radar_bounds(west, south, east, north, layer):
    if layer in ('radar_wide', 'radar_history'):
        for value, expected in zip((west, south, east, north), (99.638609, -2.967382, 108.290871, 5.657912)):
            number(value, expected-.05, expected+.05)
    else:
        number(west, 103, 104); number(east, 104, 105)
        number(north, 1.5, 2.2); number(south, 0, 1)
    if west >= east or south >= north: raise ValueError('Invalid radar bounds')


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
            **empty_layer_data(layer, now)}


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
        if layer == 'radar_history':
            validate_history(frame, now)
            return
        if frame['state'] != 'unavailable' and (frame['observed_at'] is None or frame['fetched_at'] is None
                or not frame['stations' if layer == 'wind' else 'points' if layer == 'wind_regional' else 'radar']):
            raise ValueError('Weather observations are missing')
        if layer == 'wind':
            if not isinstance(frame['stations'], list) or len(frame['stations']) > 1000: raise ValueError()
            for station in frame['stations']:
                if not isinstance(station['id'], str) or not isinstance(station['name'], str): raise ValueError()
                number(station['lat'], 1, 1.6); number(station['lon'], 103.5, 104.2)
                number(station['speed_mps'], 0, 103); number(station['from_deg'], 0, 360)
        elif layer == 'wind_regional':
            if any(frame[key] != value for key, value in empty_layer_data(layer).items() if key != 'points'): raise ValueError()
            if not isinstance(frame['points'], list) or len(frame['points']) > len(REGIONAL_GRID): raise ValueError()
            seen = set()
            for point in frame['points']:
                ident = point['id']
                if not isinstance(ident, str) or ident not in REGIONAL_BY_ID or ident in seen: raise ValueError()
                validate_model_position(point['lat'], point['lon'], REGIONAL_BY_ID[ident])
                number(point['speed_mps'], 0, 103); number(point['from_deg'], 0, 360)
                seen.add(ident)
        elif layer == 'radar_wide' and frame['range_km'] != 480: raise ValueError()
        if layer in ('radar', 'radar_wide') and frame['radar'] is not None:
            radar = frame['radar']; image_url(radar['url'])
            radar_bounds(radar['west'], radar['south'], radar['east'], radar['north'], layer)
            number(radar['expires_at'], 0, now+86400)
            if radar['observed_at'] != frame['observed_at']: raise ValueError()
    except (KeyError, TypeError, AttributeError):
        raise ValueError('Invalid cached weather') from None


def validate_history(frame, now):
    if frame['range_km'] != 480 or frame['expected_frames'] != 13: raise ValueError()
    end = number(frame['window_end'], 3600, now+60)
    start = number(frame['window_start'], 0, end)
    if end % 300 or end-start != 3600: raise ValueError('Invalid radar history window')
    frames = frame['frames']
    if not isinstance(frames, list) or len(frames) > 13: raise ValueError()
    if frame['state'] != 'unavailable' and (not frames or frame['fetched_at'] is None): raise ValueError()
    if frames and frame['fetched_at'] is None: raise ValueError()
    if frame['fetched_at'] is not None and not end <= frame['fetched_at'] < end+300:
        raise ValueError('Radar history window does not match snapshot time')
    last = None
    for radar in frames:
        at = number(radar['observed_at'], start, end)
        if last is not None and at <= last: raise ValueError('Radar history must be unique and ascending')
        image_url(radar['url'])
        radar_bounds(radar['west'], radar['south'], radar['east'], radar['north'], 'radar_history')
        number(radar['expires_at'], 0, now+86400)
        last = at
    if frame['observed_at'] != last: raise ValueError('Radar history observation does not match frames')


def render(frame, now):
    validate_frame(frame, now)
    result = deepcopy(frame)
    layer = result['layer']; observed = result['observed_at']
    if layer == 'radar_history':
        result['frames'] = [radar for radar in result['frames'] if radar['expires_at'] > now]
        fetched = result['fetched_at']
        age = now-fetched if fetched is not None else math.inf
        if age > 900 or now-result['window_end'] > 900:
            result.update(state='unavailable', frames=[], message='Radar history snapshot is too old')
        elif not result['frames']:
            result.update(state='unavailable', message=result['message'] or 'Radar history images have expired')
        elif age > FRESH_AGE[layer]:
            result.update(state='stale', message=result['message'] or 'Radar history update is delayed')
        result['observed_at'] = result['frames'][-1]['observed_at'] if result['frames'] else None
        return result
    if observed is None: return result
    age = now - number(observed, 0, now + 60)
    if layer in ('radar', 'radar_wide') and (not result['radar'] or result['radar']['expires_at'] <= now):
        result.update(state='unavailable', radar=None, message='Radar image has expired')
    elif age > (3600 if layer == 'wind_regional' else 1800):
        result.update(state='unavailable', message='Weather observations are too old')
        result.update(empty_layer_data(layer))
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


def normalize_regional_wind(payload, now):
    if not isinstance(payload, list) or len(payload) != len(REGIONAL_GRID):
        raise ValueError('Incomplete regional model batch')
    readings = []
    for raw, requested in zip(payload, REGIONAL_GRID):
        try:
            if raw['utc_offset_seconds'] != 0: raise ValueError()
            units, current = raw['current_units'], raw['current']
            if (units['time'] != 'unixtime' or units['interval'] != 'seconds'
                    or units['wind_speed_10m'] != 'm/s' or units['wind_direction_10m'] != '°'
                    or current['interval'] != 900): raise ValueError()
            valid = number(current['time'], 0, now+60)
            lat, lon = raw['latitude'], raw['longitude']
            validate_model_position(lat, lon, requested)
            speed = number(current['wind_speed_10m'], 0, 103)
            direction = number(current['wind_direction_10m'], 0, 360) % 360
            readings.append((valid, {'id': requested['id'], 'lat': lat, 'lon': lon, 'speed_mps': speed, 'from_deg': direction}))
        except (KeyError, ValueError, TypeError):
            continue
    if not readings: raise ValueError('No usable regional model points')
    valid = max(at for at, _ in readings)
    result = envelope('wind_regional', now, valid)
    result['points'] = [point for at, point in readings if at == valid]
    return render(result, now)


def normalize_radar(payload, now, layer='radar'):
    try:
        data = data_body(payload); bounds = data['boundaryBox']
        if bounds['crs'] != 'EPSG:4326': raise ValueError('Unsupported radar coordinates')
        west, north = bounds['upperLeft']['longitude'], bounds['upperLeft']['latitude']
        east, south = bounds['lowerRight']['longitude'], bounds['lowerRight']['latitude']
        radar_bounds(west, south, east, north, layer)
        record = max(data['records'], key=lambda r: timestamp(r['timestamp']))
        observed = number(timestamp(record['timestamp']), 0, now + 60)
        image = record['image']; url = image_url(image['url'])
        if image['range'] != ('480km' if layer == 'radar_wide' else '70km') or image['format'].lower() != 'png':
            raise ValueError('Unsupported radar image')
        expires = number(timestamp(image['urlExpiresAt']), now + 1, now + 86400)
        result = envelope(layer, now, observed)
        result['radar'] = {'url': url, 'west': west, 'south': south, 'east': east, 'north': north,
                           'observed_at': observed, 'expires_at': expires}
        return render(result, now)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ValueError('Invalid radar response') from None


def normalize_radar_history(payloads, now):
    """Normalize actual day-page observations without live radar's age cutoff."""
    result = envelope('radar_history', now)
    frames = {}
    try:
        for payload in payloads:
            data = data_body(payload)
            bounds, projection = data['boundaryBox'], data['projection']
            if bounds['crs'] != 'EPSG:4326' or projection['type'] != 'Azimuthal Equidistant':
                raise ValueError('Unsupported radar projection')
            number(projection['center']['longitude'], 103.922583, 104.022583)
            number(projection['center']['latitude'], 1.29911, 1.39911)
            west, north = bounds['upperLeft']['longitude'], bounds['upperLeft']['latitude']
            east, south = bounds['lowerRight']['longitude'], bounds['lowerRight']['latitude']
            radar_bounds(west, south, east, north, 'radar_history')
            if not isinstance(data['records'], list): raise ValueError('Invalid radar records')
            for record in data['records']:
                try:
                    at = number(timestamp(record['timestamp']), result['window_start'], result['window_end'])
                    image = record['image']
                    if image['range'] != '480km' or image['format'].lower() != 'png': raise ValueError()
                    radar = {'url': image_url(image['url']), 'west': west, 'south': south, 'east': east, 'north': north,
                             'observed_at': at, 'expires_at': number(timestamp(image['urlExpiresAt']), now+1, now+86400)}
                except (KeyError, TypeError, AttributeError, ValueError):
                    continue
                if at not in frames or radar['expires_at'] > frames[at]['expires_at']:
                    frames[at] = radar
        if not frames: raise ValueError('No usable radar history observations')
        result.update(state='fresh', fetched_at=now, observed_at=max(frames),
                      frames=[frames[at] for at in sorted(frames)[-13:]])
        return render(result, now)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ValueError('Invalid radar history response') from None

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
local reservation = tonumber(ARGV[5])
redis.call('SET', KEYS[1] .. ':retry', now+reservation, 'EX', reservation)
return {'refresh', payload, tostring(reservation)}
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
                                    digest, token, int(start.timestamp()), int(end.timestamp()), max(300, INTERVAL[self.layer]))
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

    async def fetch(self, name, params=None):
        key = os.getenv('DATAGOV_API_KEY', '') if name != 'wind_regional' else ''
        if name == 'wind_regional':
            params = {'latitude': ','.join(str(p['lat']) for p in REGIONAL_GRID),
                      'longitude': ','.join(str(p['lon']) for p in REGIONAL_GRID),
                      'current': 'wind_speed_10m,wind_direction_10m', 'wind_speed_unit': 'ms',
                      'timeformat': 'unixtime', 'timezone': 'UTC', 'forecast_days': 1, 'cell_selection': 'nearest'}
        try:
            response = await self.client.get(URLS[name], headers={'x-api-key': key} if key else {},
                                             params=params, timeout=8, follow_redirects=False)
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
        if previous.get('frame'):
            validate_frame(previous['frame'], self.clock())
            if previous['frame']['layer'] != layer: raise ValueError('Cached weather layer does not match request')
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
                elif layer == 'wind_regional':
                    frame = normalize_regional_wind(await self.fetch(layer), self.clock())
                elif layer == 'radar_history':
                    now = self.clock()
                    window = history_window(now)
                    singapore = timezone(timedelta(hours=8))
                    days = dict.fromkeys(datetime.fromtimestamp(window[key], singapore).strftime('%Y-%m-%d')
                                         for key in ('window_end', 'window_start'))
                    payloads = [await self.fetch('radar_wide', {'date': day}) for day in days]
                    frame = normalize_radar_history(payloads, now)
                else:
                    frame = normalize_radar(await self.fetch(layer), self.clock(), layer=layer)
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
        return JSONResponse({'error': 'Choose layer=wind, radar, wind_regional, radar_wide or radar_history'}, status_code=400, headers=headers)
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

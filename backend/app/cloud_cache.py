"""Shared, atomic refresh coordination; never bypass Redis on failure."""
import base64
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
import uuid
import httpx

# All counters use Redis time and short expiries. The lease outlives the bounded
# upstream request, so even a crashed refresh cannot immediately duplicate polling.
CLAIM = """
local minute = math.floor(tonumber(redis.call('TIME')[1]) / 60)
local ip = KEYS[1] .. ':viewer:' .. ARGV[1] .. ':' .. minute
local m = redis.call('INCR', ip)
if m == 1 then redis.call('EXPIRE', ip, 120) end
if m > 8 then return {'limited'} end
local global = KEYS[1] .. ':global:' .. minute
local n = redis.call('INCR', global)
if n == 1 then redis.call('EXPIRE', global, 120) end
if n > 60 then return {'limited'} end
local payload = redis.call('GET', KEYS[1] .. ':snapshot') or ''
if redis.call('EXISTS', KEYS[1] .. ':ready') == 1 then return {'cached', payload} end
local lock = redis.call('SET', KEYS[1] .. ':lease', ARGV[2], 'NX', 'EX', 35)
if lock then return {'refresh', redis.call('GET', KEYS[1] .. ':data') or ''} end
return {'cached', payload}
"""
PUBLISH = """
if redis.call('GET', KEYS[1] .. ':lease') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1] .. ':data', ARGV[2])
redis.call('SET', KEYS[1] .. ':snapshot', ARGV[3])
redis.call('SET', KEYS[1] .. ':ready', '1', 'EX', 15)
redis.call('DEL', KEYS[1] .. ':lease')
return 1
"""

CHECKPOINT = """
if redis.call('GET', KEYS[1] .. ':lease') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1] .. ':data', ARGV[2])
return 1
"""

class CacheUnavailable(Exception): pass
class CacheLimited(Exception): pass

@dataclass
class Claim:
    state: dict | None
    token: str | None

class RedisCache:
    def __init__(self, client, url, secret, prefix='changi:cloud:v1'):
        self.client, self.url, self.secret, self.prefix = client, url, secret, prefix

    async def command(self, *args):
        if not self.url.startswith('https://') or not self.secret:
            raise CacheUnavailable()
        try:
            response = await self.client.post(self.url, json=list(args),
                headers={'Authorization': 'Bearer '+self.secret}, timeout=4)
            response.raise_for_status()
            body = response.json()
            if not isinstance(body, dict) or 'error' in body or 'result' not in body:
                raise CacheUnavailable()
            return body['result']
        except (httpx.HTTPError, ValueError, KeyError):
            raise CacheUnavailable() from None

    async def claim(self, viewer):
        digest = hashlib.sha256((self.secret+viewer).encode()).hexdigest()[:24]
        token = uuid.uuid4().hex
        result = await self.command('EVAL', CLAIM, 1, self.prefix, digest, token)
        if not isinstance(result,list) or not result: raise CacheUnavailable()
        if result[0] == 'limited': raise CacheLimited()
        if result[0] not in ('cached','refresh') or len(result)!=2: raise CacheUnavailable()
        state = None
        if result[1]:
            try:
                if len(result[1]) > 2_000_000: raise ValueError()
                with gzip.GzipFile(fileobj=io.BytesIO(base64.b64decode(result[1], validate=True))) as stream:
                    raw = stream.read(8_000_001)
                if len(raw)>8_000_000: raise ValueError()
                state = json.loads(raw)
                if not isinstance(state,dict): raise ValueError()
            except (ValueError, OSError, EOFError): raise CacheUnavailable() from None
        return Claim(state, token if result[0]=='refresh' else None)

    def encode(self, state):
        raw = json.dumps(state, separators=(',',':'), allow_nan=False).encode()
        if len(raw)>8_000_000: raise CacheUnavailable()
        payload = base64.b64encode(gzip.compress(raw)).decode()
        return payload

    async def checkpoint(self, token, state):
        if await self.command('EVAL', CHECKPOINT, 1, self.prefix, token, self.encode(state)) != 1:
            raise CacheUnavailable()

    async def publish(self, token, state):
        cached = {'snapshot':state['snapshot']} if 'snapshot' in state else state
        return await self.command('EVAL', PUBLISH, 1, self.prefix, token,
            self.encode(state), self.encode(cached)) == 1

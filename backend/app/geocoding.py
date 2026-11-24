"""Explicit Singapore postal lookups; only the provider token is cached."""
import hashlib
import math
import os
import time
import httpx
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field
from .cloud_cache import RedisCache,CacheUnavailable

class LookupUnavailable(Exception):pass

class PostalQuery(BaseModel):
    model_config=ConfigDict(extra='forbid')
    postal:str=Field(pattern=r'^\d{6}$',strict=True)

class OneMapGeocoder:
    def __init__(self,client,cache,email,password,clock=time.time):
        self.client,self.cache,self.email,self.password,self.clock=client,cache,email,password,clock
        self.key='changi:geocode:v1:'+hashlib.sha256(email.encode()).hexdigest()[:16]

    async def token(self):
        if await self.cache.command('GET',self.key+':backoff'):raise LookupUnavailable()
        token=await self.cache.command('GET',self.key+':token')
        if token:return token
        if not await self.cache.command('SET',self.key+':auth-lock','1','NX','EX',20):raise LookupUnavailable()
        # Leave the short lease to expire: an old caller must not delete a newer lease.
        try:
            response=await self.client.post('https://www.onemap.gov.sg/api/auth/post/getToken',
                json={'email':self.email,'password':self.password},timeout=5)
            response.raise_for_status();body=response.json()
            if not isinstance(body,dict):raise ValueError()
            token=body.get('access_token');ttl=float(body.get('expiry_timestamp',0))-self.clock()-60
            if not isinstance(token,str) or not token or len(token)>8192 or not math.isfinite(ttl) or ttl<=0:raise ValueError()
            await self.cache.command('SET',self.key+':token',token,'EX',min(172800,int(ttl)))
            return token
        except (httpx.HTTPError,ValueError,TypeError):
            await self.cache.command('SET',self.key+':backoff','1','EX',300)
            raise LookupUnavailable() from None

    async def search(self,postal):
        token=await self.token()
        try:
            response=await self.client.get('https://www.onemap.gov.sg/api/common/elastic/search',
                params={'searchVal':postal,'returnGeom':'Y','getAddrDetails':'Y','pageNum':1},
                headers={'Authorization':token},timeout=5)
            if response.status_code in (401,403):
                await self.cache.command('DEL',self.key+':token')
            if response.status_code in (401,403,429):
                await self.cache.command('SET',self.key+':backoff','1','EX',60)
            response.raise_for_status();body=response.json()
            if not isinstance(body,dict):raise ValueError()
            if 'error' in body:
                await self.cache.command('DEL',self.key+':token')
                await self.cache.command('SET',self.key+':backoff','1','EX',60)
                raise LookupUnavailable()
            rows=body.get('results')
            if not isinstance(rows,list):raise ValueError()
            found=[];seen=set()
            for row in rows[:100]:
                if not isinstance(row,dict) or row.get('POSTAL')!=postal:continue
                try:lat,lon=float(row['LATITUDE']),float(row['LONGITUDE'])
                except (KeyError,ValueError,TypeError):continue
                if not 1.15<=lat<=1.48 or not 103.59<=lon<=104.11 or (lat,lon) in seen:continue
                label=row.get('ADDRESS')
                if not isinstance(label,str) or not label.strip():continue
                found.append({'lat':lat,'lon':lon,'label':label[:240],'postal':postal});seen.add((lat,lon))
            return found[:10]
        except (httpx.HTTPError,ValueError,TypeError):raise LookupUnavailable() from None

LIMIT='''
local minute=math.floor(tonumber(redis.call('TIME')[1])/60)
local viewer=KEYS[1]..':viewer:'..ARGV[1]..':'..minute
local v=redis.call('INCR',viewer)
if v==1 then redis.call('EXPIRE',viewer,120) end
if v>5 then return 0 end
local global=KEYS[1]..':global:'..minute
local n=redis.call('INCR',global)
if n==1 then redis.call('EXPIRE',global,120) end
return n<=20 and 1 or 0
'''
router=APIRouter()
@router.post('/api/location/postal')
async def postal_lookup(query:PostalQuery,request:Request):
    headers={'Cache-Control':'no-store','Retry-After':'60'}
    email,password=os.getenv('ONEMAP_EMAIL',''),os.getenv('ONEMAP_PASSWORD','')
    if not email or not password:
        return JSONResponse({'detail':'Postal search is not configured. Use Drop pin.'},status_code=503,headers=headers)
    secret=os.getenv('KV_REST_API_TOKEN',os.getenv('UPSTASH_REDIS_REST_TOKEN',''))
    viewer=request.headers.get('x-vercel-forwarded-for','unknown') if os.getenv('VERCEL') else request.client.host if request.client else 'unknown'
    digest=hashlib.sha256((secret+viewer).encode()).hexdigest()[:24]
    async with httpx.AsyncClient(follow_redirects=False) as client:
        cache=RedisCache(client,os.getenv('KV_REST_API_URL',os.getenv('UPSTASH_REDIS_REST_URL','')),secret)
        try:
            if not await cache.command('EVAL',LIMIT,1,'changi:geocode:limits',digest):
                return JSONResponse({'detail':'Search limit reached. Try again in a minute.'},status_code=429,headers=headers)
            results=await OneMapGeocoder(client,cache,email,password).search(query.postal)
            return JSONResponse({'results':results,'attribution':'OneMap · Singapore Land Authority'},headers={'Cache-Control':'no-store'})
        except (CacheUnavailable,LookupUnavailable):
            return JSONResponse({'detail':'Postal search is temporarily unavailable. Use Drop pin.'},status_code=503,headers=headers)

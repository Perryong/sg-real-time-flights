"""Small-area OpenSky ground observations; credentials and tokens stay server-side."""
import json
import re
import time
from email.utils import parsedate_to_datetime
import httpx
from .contracts import Observation
from .normalize import number, text
from .provider import ProviderError, ProviderResult

TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
STATES_URL = 'https://opensky-network.org/api/states/all'
BOX = {'lamin':1.30, 'lamax':1.40, 'lomin':103.965, 'lomax':104.03, 'extended':1}

def normalize_ground(raw, provider_time, receipt):
    if not isinstance(raw,list) or len(raw)<17 or not isinstance(raw[0],str): return None
    ident=raw[0].lower()
    if not re.fullmatch(r'[0-9a-f]{6}',ident) or raw[8] is not True: return None
    category=raw[17] if len(raw)>17 else None
    # Unknown emitters can be airport vehicles; require an aircraft category.
    if type(category) is not int or category not in (2,3,4,5,6,7,8,9,10,12,14,15): return None
    lat,lon,position=number(raw[6]),number(raw[5]),number(raw[3])
    if lat is None or lon is None or not BOX['lamin']<=lat<=BOX['lamax'] or not BOX['lomin']<=lon<=BOX['lomax']: return None
    if position is None or not 946684800<=position<=provider_time<=receipt or receipt-position>120: return None
    message=number(raw[4])
    if message is not None and not 946684800<=message<=provider_time: message=None
    speed,heading=number(raw[9]),number(raw[10])
    return Observation(id=f'live:opensky:{ident}',provider='opensky',provider_id=ident,
        session_id='initial',mode='live',callsign=text(raw[1]),lat=lat,lon=lon,
        ground=True,alt_baro_m=number(raw[7]),alt_geom_m=number(raw[13]),
        speed_mps=speed if speed is not None and speed>=0 else None,
        track_deg=heading if heading is not None and 0<=heading<360 else None,
        vertical_rate_mps=number(raw[11]),position_time=position,provider_time=provider_time,
        message_time=message,receipt_time=receipt,timestamp_quality='derived',
        source_category={0:'ADS-B',1:'ASTERIX',2:'MLAT',3:'FLARM'}.get(raw[16]) if type(raw[16]) is int else None,
        quality={'category':category})

class OpenSkyGroundProvider:
    def __init__(self,client,client_id,client_secret,clock=time.time):
        self.client,self.client_id,self.client_secret,self.clock=client,client_id,client_secret,clock
        self.token=None;self.expires_at=0;self.remaining_credits=None

    async def _json(self,method,url,limit,**kwargs):
        try:
            async with self.client.stream(method,url,timeout=5,**kwargs) as r:
                if r.status_code!=200:
                    retry=None
                    if r.status_code==429:
                        value=r.headers.get('X-Rate-Limit-Retry-After-Seconds') or r.headers.get('Retry-After','300')
                        try: retry=float(value)
                        except ValueError:
                            try: retry=parsedate_to_datetime(value).timestamp()-self.clock()
                            except (ValueError,TypeError,OverflowError): retry=300
                        if number(retry) is None: retry=300
                        retry=max(30,retry)
                    token_expired=r.status_code==401 and url==STATES_URL
                    if token_expired:self.token=None
                    raise ProviderError('token_expired' if token_expired else str(r.status_code),
                        pause=r.status_code in (401,403) and not token_expired,retry_after=retry)
                chunks=[];size=0
                async for chunk in r.aiter_bytes():
                    size+=len(chunk)
                    if size>limit:raise ProviderError('payload_too_large')
                    chunks.append(chunk)
                return json.loads(b''.join(chunks)),r.headers
        except (httpx.HTTPError,ValueError) as error:
            raise ProviderError('network_or_json') from None

    async def fetch(self):
        if not self.token or self.clock()>=self.expires_at-30:
            grant,_=await self._json('POST',TOKEN_URL,64000,data={
                'grant_type':'client_credentials','client_id':self.client_id,'client_secret':self.client_secret})
            if not isinstance(grant,dict):raise ProviderError('invalid_token_response')
            token=grant.get('access_token');expiry=number(grant.get('expires_in'))
            if not isinstance(token,str) or not token or len(token)>16000 or expiry is None or expiry<=30:
                raise ProviderError('invalid_token_response')
            self.token=token;self.expires_at=self.clock()+expiry
        payload,headers=await self._json('GET',STATES_URL,5_000_000,params=BOX,
            headers={'Authorization':f'Bearer {self.token}','Accept':'application/json'})
        try:self.remaining_credits=max(0,int(headers['X-Rate-Limit-Remaining']))
        except (KeyError,ValueError):self.remaining_credits=None
        receipt=self.clock()
        if not isinstance(payload,dict) or 'states' not in payload:raise ProviderError('invalid_schema')
        timestamp=number(payload.get('time'));rows=payload['states']
        if timestamp is None or not 946684800<=timestamp<=receipt or (rows is not None and not isinstance(rows,list)):
            raise ProviderError('invalid_schema')
        rows=rows or []
        if len(rows)>10000:raise ProviderError('invalid_schema')
        observations=[o for row in rows if (o:=normalize_ground(row,timestamp,receipt)) is not None]
        return ProviderResult(observations,0)

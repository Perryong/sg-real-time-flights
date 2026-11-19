import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
import httpx
from .normalize import normalize_record, number
from .contracts import Observation

@dataclass
class ProviderResult:
    observations: list[Observation]
    invalid: int

class ProviderError(Exception):
    def __init__(self, code, pause=False, retry_after=None):
        self.code, self.pause, self.retry_after = code, pause, retry_after
        super().__init__(code)

class AirplanesProvider:
    URL = 'https://api.airplanes.live/v2/point/1.3644/103.9915/25'
    def __init__(self, client: httpx.AsyncClient, clock=time.time, now_units='seconds', token=''):
        self.client, self.clock, self.now_units, self.token = client, clock, now_units, token

    async def fetch(self) -> ProviderResult:
        try:
            async with self.client.stream('GET', self.URL, timeout=5,
                    headers={'Authorization':f'Bearer {self.token}'} if self.token else {}) as response:
                if response.status_code != 200:
                    retry = None
                    if response.status_code == 429:
                        value = response.headers.get('Retry-After', '')
                        try: retry = max(0, float(value))
                        except ValueError:
                            try: retry = max(0, parsedate_to_datetime(value).timestamp()-self.clock())
                            except (ValueError, TypeError, OverflowError): retry = 60
                    raise ProviderError(str(response.status_code), response.status_code in (401,403), retry)
                chunks=[]; size=0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > 5_000_000: raise ProviderError('payload_too_large')
                    chunks.append(chunk)
                import json
                payload=json.loads(b''.join(chunks))
        except (httpx.HTTPError, ValueError) as error:
            raise ProviderError('network_or_json') from error
        if not isinstance(payload,dict) or not isinstance(payload.get('ac'),list) or len(payload['ac'])>10000:
            raise ProviderError('invalid_schema')
        now=number(payload.get('now'))
        if now is not None and self.now_units=='milliseconds': now/=1000
        receipt=self.clock()
        observations=[]; invalid=0
        for raw in payload['ac']:
            o=normalize_record(raw,now,receipt,'live',True)
            if o is None: invalid+=1
            else: observations.append(o)
        return ProviderResult(observations,invalid)

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

@dataclass
class Settings:
    live_enabled: bool = False
    poll_seconds: float = 10
    origins: tuple[str, ...] = ('http://localhost:5177','http://127.0.0.1:5177','http://localhost:4177','http://127.0.0.1:4177')
    token: str = field(default='', repr=False)
    now_units: str = 'seconds'

    @classmethod
    def from_env(cls):
        verified = os.getenv('AIRPLANES_ACCESS_VERIFIED') == 'true'
        enabled = os.getenv('LIVE_ENABLED') == 'true'
        units = os.getenv('AIRPLANES_NOW_UNITS', 'seconds')
        if units not in ('seconds', 'milliseconds'):
            raise ValueError('AIRPLANES_NOW_UNITS must be seconds or milliseconds')
        return cls(live_enabled=enabled and verified,
            poll_seconds=max(10, float(os.getenv('POLL_SECONDS','10'))),
            origins=tuple(os.getenv('ALLOWED_ORIGINS',','.join(cls.origins)).split(',')),
            token=os.getenv('AIRPLANES_TOKEN',''), now_units=units)

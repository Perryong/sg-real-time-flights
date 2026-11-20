import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

@dataclass
class Settings:
    live_enabled: bool = False
    poll_seconds: float = 10
    opensky_enabled: bool = False
    opensky_reason: str = 'disabled'
    opensky_client_id: str = field(default='',repr=False)
    opensky_client_secret: str = field(default='',repr=False)
    flyitaly_enabled: bool = False
    flyitaly_api_key: str = field(default='',repr=False)
    origins: tuple[str, ...] = ('http://localhost:5177','http://127.0.0.1:5177','http://localhost:4177','http://127.0.0.1:4177')

    @classmethod
    def from_env(cls):
        personal = os.getenv('ADSBFI_PERSONAL_USE') == 'true'
        enabled = os.getenv('LIVE_ENABLED') == 'true'
        requested=os.getenv('OPENSKY_ENABLED')=='true'
        confirmed=os.getenv('OPENSKY_USE_CONFIRMED')=='true'
        client_id=os.getenv('OPENSKY_CLIENT_ID','').strip()
        client_secret=os.getenv('OPENSKY_CLIENT_SECRET','').strip()
        flyitaly_key=os.getenv('FLYITALYADSB_API_KEY','').strip()
        reason='disabled' if not requested else 'permission_required' if not confirmed else 'credentials_required' if not (client_id and client_secret) else ''
        return cls(live_enabled=enabled and personal,
            flyitaly_enabled=os.getenv('FLYITALYADSB_ENABLED')=='true' and bool(flyitaly_key),flyitaly_api_key=flyitaly_key,
            opensky_enabled=not bool(reason),opensky_reason=reason,
            opensky_client_id=client_id,opensky_client_secret=client_secret,
            poll_seconds=max(10, float(os.getenv('POLL_SECONDS','10'))),
            origins=tuple(os.getenv('ALLOWED_ORIGINS',','.join(cls.origins)).split(',')))

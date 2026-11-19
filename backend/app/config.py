import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

@dataclass
class Settings:
    live_enabled: bool = False
    poll_seconds: float = 10
    origins: tuple[str, ...] = ('http://localhost:5177','http://127.0.0.1:5177','http://localhost:4177','http://127.0.0.1:4177')

    @classmethod
    def from_env(cls):
        personal = os.getenv('ADSBFI_PERSONAL_USE') == 'true'
        enabled = os.getenv('LIVE_ENABLED') == 'true'
        return cls(live_enabled=enabled and personal,
            poll_seconds=max(10, float(os.getenv('POLL_SECONDS','10'))),
            origins=tuple(os.getenv('ALLOWED_ORIGINS',','.join(cls.origins)).split(',')))

from typing import Literal, Any
from pydantic import BaseModel, Field, ConfigDict

Mode = Literal['live', 'simulated', 'recorded']

class Observation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str
    provider: str
    provider_id: str
    session_id: str
    mode: Mode
    callsign: str | None = None
    registration: str | None = None
    aircraft_type: str | None = None
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    alt_geom_m: float | None = None
    alt_baro_m: float | None = None
    ground: bool | None = None
    speed_mps: float | None = None
    track_deg: float | None = None
    heading_deg: float | None = None
    vertical_rate_mps: float | None = None
    position_time: float | None = None
    provider_time: float | None = None
    message_time: float | None = None
    receipt_time: float
    timestamp_quality: Literal['derived', 'unknown'] = 'unknown'
    source_category: str | None = None
    quality: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)

class PhaseEstimate(BaseModel):
    phase: str = 'unknown'
    candidate_runways: list[str] = Field(default_factory=list)
    confidence: Literal['low', 'medium', 'high'] = 'low'
    reasons: list[str] = Field(default_factory=lambda: ['Insufficient continuous observations'])
    evidence_times: list[float] = Field(default_factory=list)
    rule_version: str = '1.0'

class Track(BaseModel):
    id: str
    session_id: str
    latest: Observation
    history: list[Observation]
    phase: PhaseEstimate = Field(default_factory=PhaseEstimate)

class FeedStatus(BaseModel):
    mode: Mode = 'live'
    upstream_state: str = 'unavailable'
    error_code: str | None = 'configuration_required'
    message: str = 'Airplanes.live access and usage policy require verification. No live polling enabled.'
    last_attempt: float | None = None
    last_success: float | None = None
    next_retry: float | None = None
    newest_position_time: float | None = None
    geometry_edition: str = 'CAAS 03 SEP 2026; current status unverified'
    counters: dict[str, int | float] = Field(default_factory=dict)

class Snapshot(BaseModel):
    type: Literal['snapshot'] = 'snapshot'
    schema_version: Literal[1] = 1
    epoch: str
    sequence: int
    mode: Mode
    server_time: float
    scenario_time: float | None = None
    status: FeedStatus
    tracks: list[Track]

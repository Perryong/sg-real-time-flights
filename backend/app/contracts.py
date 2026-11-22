from typing import Literal, Any
from pydantic import BaseModel, Field, ConfigDict, PrivateAttr

Mode = Literal['live', 'simulated', 'recorded']

class HistoricalRoute(BaseModel):
    model_config = ConfigDict(strict=True, allow_inf_nan=False)
    provider: Literal['flyitalyadsb'] = 'flyitalyadsb'
    callsign: str = Field(min_length=1, max_length=100)
    origin: str = Field(pattern=r'^[A-Z]{4}$')
    destination: str = Field(pattern=r'^[A-Z]{4}$')
    origin_iata: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    destination_iata: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    observed_count: int = Field(ge=1, le=100000)
    last_seen_day: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    retrieved_at: float

class Observation(BaseModel):
    route: HistoricalRoute | None = None
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
    # Bounded internal event memory survives pending hysteresis, never serialized.
    _event_context: tuple[str, str, str, float] | None = PrivateAttr(default=None)
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

class SourceStatus(BaseModel):
    enabled: bool
    state: str
    error_code: str | None = None
    last_attempt: float | None = None
    last_success: float | None = None
    next_retry: float | None = None
    requests: int = 0
    remaining_credits: int | None = None

class MovementSummary(BaseModel):
    day: str
    airport: Literal['WSSS'] = 'WSSS'
    timezone: Literal['Asia/Singapore'] = 'Asia/Singapore'
    available: bool = True
    landings: int = 0
    takeoffs: int = 0
    first_observed_at: float | None = None
    last_observed_at: float | None = None
    observed_seconds: float = 0
    unmonitored_seconds: float = 0

class FeedStatus(BaseModel):
    collection_mode: Literal['continuous', 'on_demand'] = 'continuous'
    movements: MovementSummary | None = None
    mode: Mode = 'live'
    upstream_state: str = 'unavailable'
    error_code: str | None = 'configuration_required'
    message: str = 'ADSB.fi live polling is disabled. Enable live mode for personal, non-commercial use in the backend configuration.'
    last_attempt: float | None = None
    last_success: float | None = None
    next_retry: float | None = None
    newest_position_time: float | None = None
    geometry_edition: str = 'Open geometry · 19 NOV 2026 (provisional)'
    counters: dict[str, int | float] = Field(default_factory=dict)
    sources: dict[str, SourceStatus] = Field(default_factory=dict)

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

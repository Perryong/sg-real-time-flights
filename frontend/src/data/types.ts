export type Mode = "live" | "simulated" | "recorded";
export interface HistoricalRoute {
  provider: "flyitalyadsb";
  callsign: string;
  origin: string;
  destination: string;
  origin_iata: string | null;
  destination_iata: string | null;
  observed_count: number;
  last_seen_day: string;
  retrieved_at: number;
}
export interface Observation {
  route?: HistoricalRoute | null;
  id: string;
  provider: string;
  provider_id: string;
  session_id: string;
  mode: Mode;
  callsign: string | null;
  registration: string | null;
  aircraft_type: string | null;
  lat: number;
  lon: number;
  alt_geom_m: number | null;
  alt_baro_m: number | null;
  ground: boolean | null;
  speed_mps: number | null;
  track_deg: number | null;
  heading_deg: number | null;
  vertical_rate_mps: number | null;
  position_time: number | null;
  provider_time: number | null;
  receipt_time: number;
  message_time: number | null;
  timestamp_quality: "derived" | "unknown";
  source_category: string | null;
  quality: Record<string, unknown>;
  raw: Record<string, unknown>;
}
export interface PhaseEstimate {
  phase: string;
  candidate_runways: string[];
  confidence: "low" | "medium" | "high";
  reasons: string[];
  evidence_times: number[];
  rule_version: string;
}
export interface Track {
  id: string;
  session_id: string;
  latest: Observation;
  history: Observation[];
  phase: PhaseEstimate;
}
export interface SourceStatus {
  enabled: boolean;
  state: string;
  error_code: string | null;
  last_attempt: number | null;
  last_success: number | null;
  next_retry: number | null;
  requests: number;
  remaining_credits: number | null;
}
export interface MovementCounts {
  day: string;
  airport: "WSSS";
  timezone: "Asia/Singapore";
  available: boolean;
  landings: number;
  takeoffs: number;
  first_observed_at: number | null;
  last_observed_at: number | null;
  observed_seconds: number;
  unmonitored_seconds: number;
}
export interface FeedStatus {
  collection_mode?: "continuous" | "on_demand";
  movements?: MovementCounts | null;
  sources?: Record<string, SourceStatus>;
  mode: Mode;
  upstream_state: string;
  error_code: string | null;
  message: string;
  last_attempt: number | null;
  last_success: number | null;
  next_retry: number | null;
  newest_position_time: number | null;
  geometry_edition: string;
  counters: Record<string, number>;
}
export interface Snapshot {
  type: "snapshot";
  schema_version: 1;
  epoch: string;
  sequence: number;
  mode: Mode;
  server_time: number;
  scenario_time: number | null;
  status: FeedStatus;
  tracks: Track[];
}
export interface Feature {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
}
export interface Airport {
  name: string;
  edition: string;
  sources: { name: string; url: string; license: string }[];
  caveat: string;
  runways: { features: Feature[] };
  taxiways: { features: Feature[] };
  buildings: { features: Feature[] };
}

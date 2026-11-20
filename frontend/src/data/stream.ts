import type { Snapshot, Observation, FeedStatus } from "./types";
export interface StreamState {
  connectionId: number;
  snapshot: Snapshot | null;
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const nullable = (v: unknown) => v === null || finite(v);
const modes = ["live", "simulated", "recorded"];
function isRoute(r: unknown) {
  if (!object(r)) return false;
  const day=typeof r.last_seen_day === "string" ? Date.parse(r.last_seen_day+"T00:00:00Z") : NaN;
  return r.provider === "flyitalyadsb" && typeof r.callsign === "string" && r.callsign.length > 0 && r.callsign.length <= 100 &&
    ["origin", "destination"].every(k => typeof r[k] === "string" && /^[A-Z]{4}$/.test(r[k])) &&
    ["origin_iata", "destination_iata"].every(k => r[k] === null || (typeof r[k] === "string" && /^[A-Z]{3}$/.test(r[k]))) &&
    Number.isSafeInteger(r.observed_count) && r.observed_count > 0 && r.observed_count <= 100000 && finite(r.retrieved_at) &&
    Number.isFinite(day) && new Date(day).toISOString().slice(0,10) === r.last_seen_day;
}
function isObservation(v: unknown): v is Observation {
  if (
    !object(v) ||
    typeof v.id !== "string" ||
    !modes.includes(v.mode) ||
    !finite(v.lat) ||
    Math.abs(v.lat) > 90 ||
    !finite(v.lon) ||
    Math.abs(v.lon) > 180 ||
    typeof v.session_id !== "string"
  )
    return false;
  if (
    ![
      "position_time",
      "provider_time",
      "message_time",
      "alt_geom_m",
      "alt_baro_m",
      "speed_mps",
      "track_deg",
      "heading_deg",
      "vertical_rate_mps",
    ].every((k) => nullable(v[k]))
  )
    return false;
  if (
    !finite(v.receipt_time) ||
    !(v.ground === null || typeof v.ground === "boolean")
  )
    return false;
  return (
    ["callsign", "registration", "aircraft_type", "source_category"].every(
      (k) => v[k] === null || typeof v[k] === "string",
    ) &&
    (v.route == null || isRoute(v.route)) &&
    typeof v.provider === "string" &&
    typeof v.provider_id === "string" &&
    object(v.raw) &&
    object(v.quality)
  );
}
export function isStatus(v: unknown): v is FeedStatus {
  return (
    object(v) &&
    modes.includes(v.mode) &&
    typeof v.upstream_state === "string" &&
    typeof v.message === "string" &&
    typeof v.geometry_edition === "string" &&
    object(v.counters) &&
    (v.movements == null || (object(v.movements) &&
      typeof v.movements.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.movements.day) &&
      v.movements.airport === "WSSS" && v.movements.timezone === "Asia/Singapore" &&
      typeof v.movements.available === "boolean" &&
      ["landings", "takeoffs"].every(k => Number.isSafeInteger(v.movements[k]) && v.movements[k] >= 0) &&
      ["observed_seconds", "unmonitored_seconds"].every(k => finite(v.movements[k]) && v.movements[k] >= 0) &&
      ["first_observed_at", "last_observed_at"].every(k => nullable(v.movements[k])))) &&
    (v.sources === undefined || (object(v.sources) && Object.values(v.sources).every((s) =>
      object(s) && typeof s.enabled === "boolean" && typeof s.state === "string" &&
      (s.error_code === null || typeof s.error_code === "string") &&
      ["last_attempt", "last_success", "next_retry", "remaining_credits"].every(k => nullable(s[k])) &&
      finite(s.requests)))) &&
    [
      "last_attempt",
      "last_success",
      "next_retry",
      "newest_position_time",
    ].every((k) => nullable(v[k]))
  );
}
export function isSnapshot(v: unknown): v is Snapshot {
  if (
    !object(v) ||
    v.type !== "snapshot" ||
    v.schema_version !== 1 ||
    typeof v.epoch !== "string" ||
    !Number.isInteger(v.sequence) ||
    v.sequence < 0 ||
    !modes.includes(v.mode) ||
    !finite(v.server_time) ||
    !nullable(v.scenario_time) ||
    !isStatus(v.status) ||
    !Array.isArray(v.tracks) ||
    v.tracks.length > 1000
  )
    return false;
  const ids = new Set<string>();
  return v.tracks.every((t: unknown) => {
    if (
      !object(t) ||
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !isObservation(t.latest) ||
      t.latest.id !== t.id ||
      t.latest.mode !== v.mode ||
      !Array.isArray(t.history) ||
      t.history.length > 301
    )
      return false;
    ids.add(t.id);
    if (
      !t.history.every(
        (o: unknown) => isObservation(o) && o.id === t.id && o.mode === v.mode,
      )
    )
      return false;
    const p = t.phase;
    return (
      object(p) &&
      typeof p.phase === "string" &&
      Array.isArray(p.reasons) &&
      p.reasons.every((r: unknown) => typeof r === "string") &&
      Array.isArray(p.candidate_runways) &&
      p.candidate_runways.every((r: unknown) => typeof r === "string") &&
      ["low", "medium", "high"].includes(p.confidence)
    );
  });
}
export function acceptSnapshot(
  state: StreamState,
  incoming: unknown,
  connectionId: number,
): StreamState {
  if (connectionId !== state.connectionId || !isSnapshot(incoming))
    return state;
  const old = state.snapshot;
  if (
    old &&
    (incoming.epoch !== old.epoch || incoming.sequence <= old.sequence)
  )
    return state;
  return { ...state, snapshot: incoming };
}

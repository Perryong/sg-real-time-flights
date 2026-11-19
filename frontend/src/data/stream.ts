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

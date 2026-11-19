import {
  Crosshair,
  Plane,
  X,
  ArrowUpRight,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import type { Track } from "../data/types";
import { freshness } from "../data/freshness";
import { displayPosition } from "../data/display";
export const titleCase = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const formatTime = (t: number | null) =>
  t === null
    ? "Unknown"
    : new Date(t * 1000).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Singapore",
        hour12: false,
      }) + " SGT";
interface Props {
  track: Track;
  now: number;
  follow: boolean;
  onFollow: () => void;
  onClose: () => void;
}
export default function AircraftDetails({
  track,
  now,
  follow,
  onFollow,
  onClose,
}: Props) {
  const o = track.latest,
    state = freshness(o.position_time, now),
    display = displayPosition(track, now - 10, now),
    current = state === "fresh";
  const metric = (v: number | null, unit: string, factor = 1) =>
    v === null
      ? "Unknown"
      : `${Math.round(v * factor).toLocaleString()} ${unit}`;
  return (
    <section
      className="details-panel panel"
      aria-label="Selected aircraft details"
    >
      <div className="section-kicker">
        <span>SELECTED AIRCRAFT</span>
        <button
          className="icon-button small"
          aria-label="Close aircraft details"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="aircraft-heading">
        <span className="aircraft-emblem">
          <Plane size={26} />
        </span>
        <div>
          <h2>{o.callsign ?? o.provider_id}</h2>
          <p>
            {o.aircraft_type ?? "Unknown type"} <span>·</span>{" "}
            {o.registration ?? "Unknown registration"}
          </p>
        </div>
      </div>
      <div className="aircraft-silhouette" aria-hidden="true">
        <Plane size={116} strokeWidth={0.8} />
        <span>GENERIC MODEL · ESTIMATED ATTITUDE</span>
      </div>
      <div className="detail-tags">
        <span className={`badge ${o.mode === "live" ? "" : "amber"}`}>
          {o.mode === "live" ? "OBSERVED SOURCE" : o.mode.toUpperCase()}
        </span>
        <span className="badge">{titleCase(state)}</span>
      </div>
      <div className="metrics">
        <div>
          <span>BAROMETRIC ALTITUDE</span>
          <strong>{metric(o.alt_baro_m, "ft", 1 / 0.3048)}</strong>
        </div>
        <div>
          <span>GROUND SPEED</span>
          <strong>{metric(o.speed_mps, "kt", 3600 / 1852)}</strong>
        </div>
        <div>
          <span>GEOMETRIC ALTITUDE</span>
          <strong>{metric(o.alt_geom_m, "ft", 1 / 0.3048)}</strong>
        </div>
        <div>
          <span>VERTICAL RATE</span>
          <strong>{metric(o.vertical_rate_mps, "ft/min", 1 / 0.00508)}</strong>
        </div>
      </div>
      <div className="phase-box">
        <ArrowUpRight size={16} />
        <div>
          <strong>
            {current
              ? titleCase(track.phase.phase)
              : "Current phase unavailable"}
          </strong>
          <p>
            Inferred · {current ? track.phase.confidence : "unknown"} confidence
            {track.phase.candidate_runways.length
              ? ` · RWY ${track.phase.candidate_runways.join(" / ")}`
              : ""}
          </p>
        </div>
      </div>
      <ul className="reasons">
        {(current
          ? track.phase.reasons
          : [
              "Position is delayed, stale or timing is unknown. Previous phase is not a current event.",
            ]
        ).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <button
        className={`primary-button follow-button ${follow ? "following" : ""}`}
        aria-label={follow ? "Stop following" : "Follow aircraft"}
        onClick={onFollow}
        disabled={state === "lost"}
      >
        <Crosshair size={16} />
        {follow ? "Stop following" : "Follow aircraft"}
        <span>↗</span>
      </button>
      <div className="provenance">
        <h3>
          <ShieldCheck size={14} /> Observation & display
        </h3>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{o.provider}</dd>
          </div>
          <div>
            <dt>Source category</dt>
            <dd>{o.source_category ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Observed position time</dt>
            <dd>
              {o.position_time === null
                ? "Unknown"
                : new Date(o.position_time * 1000).toLocaleString("en-GB", {
                    timeZone: "Asia/Singapore",
                    hour12: false,
                  }) + " SGT"}
            </dd>
          </div>
          <div>
            <dt>
              {o.mode === "live" ? "Position age" : "Scenario position age"}
            </dt>
            <dd>
              {o.position_time === null
                ? "Unknown"
                : `${Math.max(0, Math.floor(now - o.position_time))}s`}
            </dd>
          </div>
          <div>
            <dt>Display method</dt>
            <dd>{titleCase(display.method)}</dd>
          </div>
          <div>
            <dt>Rendered time</dt>
            <dd>{formatTime(display.renderTime)}</dd>
          </div>
          <div>
            <dt>Heading / track</dt>
            <dd>{metric(o.track_deg, "°")} · estimated attitude</dd>
          </div>
        </dl>
        <p className="fine-print">
          <Clock3 size={12} /> 10s display buffer · prediction off. Height
          placement is approximate; raw altitude is retained.
        </p>
      </div>
    </section>
  );
}

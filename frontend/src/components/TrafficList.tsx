import { COVERAGE_RADIUS_KM } from "../data/coverage";
import {
  Plane,
  ChevronRight,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Search,
} from "lucide-react";
import type { Track, Mode, FeedStatus } from "../data/types";
import MovementSummary from "./MovementSummary";
import ProviderCredits from "./ProviderCredits";
import {useState} from "react";
import {changiIntent,intentLabel,routeFor} from "../data/routes";
import {OfficialBoards} from "./RouteDetails";
import { freshness } from "../data/freshness";
interface Props {
  movements?: FeedStatus["movements"];
  connected?: boolean;
  sources?: FeedStatus["sources"];
  tracks: Track[];
  selected: string | null;
  onSelect: (id: string) => void;
  now: number;
  mode: Mode;
  query: string;
  setQuery: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  onDemo: () => void;
  unavailable: boolean;
}
export default function TrafficList(p: Props) {
  const [direction,setDirection]=useState("all");
  const filtered = p.tracks.filter(
    (t) =>
      (p.mode !== "live" || direction === "all" || changiIntent(t.latest,p.now) === direction) &&
      (p.filter === "all" ||
        (p.filter === "airborne"
          ? t.latest.ground === false
          : t.latest.ground === true)) &&
      `${t.latest.callsign ?? ""} ${t.latest.provider_id} ${t.latest.registration ?? ""}`
        .toLowerCase()
        .includes(p.query.toLowerCase()),
  );
  return (
    <section className="traffic-panel panel" aria-label="Aircraft list">
      <div className="traffic-title">
        <div>
          <span className="eyebrow">SINGAPORE AIRSPACE</span>
          <h1>
            Changi Observatory<span>↗</span>
          </h1>
        </div>
        <span className="airport-code">SIN</span>
      </div>
      <div className="region-line">
        <span className="tiny-dot" /> WSSS · Singapore Changi International
      </div>
      <div className="summary-grid">
        <div>
          <strong>{p.tracks.length.toString().padStart(2, "0")}</strong>
          <span>{p.mode === "live" ? "TRACKED" : "SIMULATED"}</span>
        </div>
        <div>
          <strong>
            {p.tracks
              .filter((t) => t.latest.ground === false)
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <span>AIRBORNE</span>
        </div>
        <div>
          <strong>
            {p.tracks
              .filter((t) => t.latest.ground === true)
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <span>GROUND</span>
        </div>
      </div>
      {p.mode === "live" && <MovementSummary counts={p.movements} now={p.now} connected={!!p.connected} />}
      <label className="panel-search">
        <Search size={15} />
        <input
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
          placeholder="Find callsign or aircraft…"
          aria-label="Search aircraft"
        />
        <kbd>/</kbd>
      </label>
      <div className="tabs" aria-label="Traffic filter">
        {["all", "airborne", "ground"].map((f) => (
          <button
            key={f}
            className={p.filter === f ? "active" : ""}
            onClick={() => p.setFilter(f)}
          >
            {f === "all" ? "All aircraft" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {p.mode === "live" && <div className="direction-controls">
        <label>Changi direction
          <select aria-label="Changi direction" value={direction} onChange={e=>setDirection(e.target.value)}>
            <option value="all">All directions</option>
            <option value="inbound">Inbound to SIN (likely)</option>
            <option value="outbound">Outbound from SIN (likely)</option>
            <option value="unknown">Unknown / other</option>
          </select>
        </label>
        <OfficialBoards />
      </div>}
      <div className="list-caption">
        <span>{filtered.length} AIRCRAFT</span>
        <span>ALTITUDE / SPEED</span>
      </div>
      <div className="traffic-scroll">
        {filtered.map((t) => {
          const o = t.latest,
            state = freshness(o.position_time, p.now),
            route = routeFor(o,p.now), intent=changiIntent(o,p.now);
          return (
            <button
              className={`flight-row ${p.selected === t.id ? "selected" : ""}`}
              key={t.id}
              onClick={() => p.onSelect(t.id)}
              aria-label={`Select ${o.callsign ?? o.provider_id}`}
            >
              <span className="flight-icon">
                <Plane
                  size={20}
                  style={{ transform: `rotate(${(o.track_deg ?? 0) - 45}deg)` }}
                />
              </span>
              <span className="flight-identity">
                <strong>{o.callsign ?? o.provider_id}</strong>
                {p.mode === "live" && <small className={`route-intent ${intent}`}>{intentLabel[intent]}</small>}
                {p.mode === "live" && route && <small>Usual {route.origin_iata??route.origin} → {route.destination_iata??route.destination}</small>}
                <small>
                  {o.aircraft_type ?? "Unknown type"} <i>·</i>{" "}
                  {state === "fresh"
                    ? p.mode === "live"
                      ? "Observed"
                      : "Synthetic"
                    : state}
                </small>
              </span>
              <span className="flight-numbers">
                <strong>
                  {o.alt_baro_m === null
                    ? "—"
                    : Math.round(o.alt_baro_m / 0.3048).toLocaleString()}{" "}
                  <small>ft</small>
                </strong>
                <small>
                  {o.speed_mps === null
                    ? "Unknown"
                    : `${Math.round((o.speed_mps * 3600) / 1852)} kt`}
                  {(o.vertical_rate_mps ?? 0) > 0 ? (
                    <ArrowUpRight size={11} />
                  ) : (o.vertical_rate_mps ?? 0) < 0 ? (
                    <ArrowDownRight size={11} />
                  ) : null}
                </small>
              </span>
              <ChevronRight className="row-chevron" size={13} />
            </button>
          );
        })}
        {!filtered.length && (
          <div className="empty-list">
            <span className="empty-radar">
              <Radio size={28} />
            </span>
            <h3>
              {p.query
                ? "No matching aircraft"
                : p.unavailable
                  ? "Waiting for observations"
                  : "No aircraft reported"}
            </h3>
            <p>
              {p.query
                ? "Try another callsign or identifier."
                : p.unavailable
                  ? "The live feed is unavailable. Check Sources & accuracy for its status, or explore the separate demo."
                  : "No aircraft match this filter in the current snapshot."}
            </p>
            {p.unavailable && !p.query && (
              <button className="primary-button" onClick={p.onDemo}>
                Explore simulated traffic <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="list-footer">
        <span className="tiny-dot" />{" "}
        {p.mode === "live" ? (
          <span>
            <ProviderCredits sources={p.sources} />
            {p.unavailable ? " · unavailable" : " · observations"}
          </span>
        ) : "Synthetic scenario · not real flights"}
        <span>{COVERAGE_RADIUS_KM} km</span>
      </div>
    </section>
  );
}

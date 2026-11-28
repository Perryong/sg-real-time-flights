import { Scan } from "lucide-react";
import { useMemo } from "react";
import { journeySegmentBreak, journeyTrackGap, type Airport, type Journey, type JourneyPoint } from "./types";
import "./journey.css";

interface JourneyPanelProps {
  journey: Journey;
  selectedTime: number | null;
  onSelectTime: (time: number) => void;
  onFit: () => void;
  loading: boolean;
  message?: string;
}

const timeZone = "Asia/Singapore";
const fullTime = new Intl.DateTimeFormat("en-GB", {
  timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const shortTime = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
const dayAndTime = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "short" });
const feet = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

function AirportEndpoint({ label, airport, time, fullWidth }: {
  label: string;
  airport: Airport | null;
  time?: number | null;
  fullWidth?: boolean;
}) {
  const code = airport?.iata ?? airport?.icao;
  return (
    <div className={`journey-endpoint${fullWidth ? " journey-diversion" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <strong className={code ? "journey-airport-code" : undefined}>{code ?? airport?.name ?? airport?.city ?? "Unknown airport"}</strong>
        {code && airport?.name && <span>{airport.name}</span>}
        {airport?.city && (code || airport.name) && <span>{airport.city}</span>}
        {time != null && <time dateTime={new Date(time * 1000).toISOString()}>{fullTime.format(time * 1000)} SGT</time>}
      </dd>
    </div>
  );
}

const plot = { width: 288, height: 108, left: 40, right: 278, top: 10 };

function AltitudeChart({ points, gaps, selectedTime, onSelectTime }: Pick<JourneyPanelProps, "selectedTime" | "onSelectTime"> & {
  points: JourneyPoint[];
  gaps: number[];
}) {
  const first = points[0];
  const last = points[points.length - 1];
  const span = last.time - first.time;
  const selectedIndex = points.findIndex((point) => point.time === selectedTime);
  const latestReportedIndex = points.reduce((latest, point, index) => point.estimated ? latest : index, -1);
  const cursorIndex = selectedIndex >= 0 ? selectedIndex : latestReportedIndex >= 0 ? latestReportedIndex : points.length - 1;
  const { low, high } = points.reduce(({ low, high }, { altitude_ft: altitude }) => ({
    low: Math.min(low, altitude ?? 0),
    high: Math.max(high, altitude ?? 0),
  }), { low: 0, high: 2_000 });
  const step = high <= 5_000 ? 1_000 : high <= 20_000 ? 5_000 : 10_000;
  const floor = Math.floor(low / step) * step;
  const ceiling = Math.ceil(high / step) * step;
  const x = (time: number) => span === 0
    ? (plot.left + plot.right) / 2
    : plot.left + (plot.right - plot.left) * (time - first.time) / span;
  const y = (altitude: number) => plot.top + (plot.height - plot.top - 14) * (ceiling - altitude) / (ceiling - floor);
  const joins = points.map((point, index) => {
    const previous = points[index - 1];
    return !!previous && previous.altitude_ft !== null && point.altitude_ft !== null && !journeySegmentBreak(previous, point);
  });
  const positions = points.map((point) => ({
    ...point, x: x(point.time), y: point.altitude_ft === null ? null : y(point.altitude_ft),
  }));
  const trace = positions.flatMap((point, index) => {
    if (!joins[index]) return [];
    const start = positions[index - 1];
    return [`M${start.x} ${start.y}L${point.x} ${point.y}`];
  }).join("");
  const current = positions[cursorIndex];
  const altitude = current.altitude_ft === null ? "Altitude unknown" : `${feet.format(current.altitude_ft)} ft`;
  const reading = `${current.estimated ? "Estimated position · " : ""}${altitude}`;
  const readingLabel = selectedIndex >= 0 ? "Selected point" : current.estimated ? "Latest estimate" : "Latest reported";
  const timestamp = `${fullTime.format(current.time * 1000)} SGT`;
  const axisTime = date.format(first.time * 1000) === date.format(last.time * 1000) ? shortTime : dayAndTime;

  return (
    <figure className="journey-altitude">
      <figcaption>
        <span>Altitude over time</span>
        <small>ft · SGT</small>
      </figcaption>
      {points.every((point) => point.altitude_ft === null) && <p>Altitude is unavailable for these positions.</p>}
      <svg
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        aria-hidden="true"
        className="journey-plot"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const plotX = (event.clientX - bounds.left) * plot.width / bounds.width;
          const nearest = positions.reduce((best, point) =>
            Math.abs(point.x - plotX) < Math.abs(best.x - plotX) ? point : best);
          onSelectTime(nearest.time);
        }}
      >
        {[ceiling, (floor + ceiling) / 2, floor].map((tick) => (
          <g key={tick} className="journey-plot-axis">
            <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} />
            <text x={plot.left - 5} y={y(tick)}>{feet.format(tick)}</text>
          </g>
        ))}
        {gaps.map((time) => (
          <line key={time} className="journey-plot-gap" x1={x(time)} x2={x(time)} y1={plot.top} y2={y(floor)} />
        ))}
        <path className="journey-plot-trace" d={trace} />
        {positions.map((point, index) => {
          if (point.y === null) {
            return <line key={point.time} className={point.estimated ? "journey-plot-estimate" : "journey-plot-unknown"}
              x1={point.x} x2={point.x} y1={plot.height - 8} y2={plot.height - 3} />;
          }
          return (point.estimated || (!joins[index] && !joins[index + 1])) &&
            <circle key={point.time} className={point.estimated ? "journey-plot-estimate" : "journey-plot-observed"} cx={point.x} cy={point.y} r="2.8" />;
        })}
        <line className="journey-plot-cursor" x1={current.x} x2={current.x} y1={plot.top} y2={plot.height - 2} />
        <circle className={`journey-plot-point${current.estimated ? " estimated" : ""}`} cx={current.x} cy={current.y ?? plot.height - 5} r="4" />
      </svg>
      <div className={`journey-plot-times${span === 0 ? " single" : ""}`} aria-hidden="true">
        <span>{axisTime.format(first.time * 1000)}</span>
        {span !== 0 && <span>{axisTime.format(last.time * 1000)}</span>}
      </div>
      {points.length > 1 ? (
        <input
          type="range"
          className="journey-scrubber"
          aria-label="Altitude observation"
          aria-valuetext={`${timestamp} · ${reading}`}
          min={0}
          max={points.length - 1}
          value={cursorIndex}
          onChange={(event) => onSelectTime(points[event.currentTarget.valueAsNumber].time)}
        />
      ) : (
        <button type="button" className="journey-locate" onClick={() => onSelectTime(current.time)}>Locate observation on map</button>
      )}
      <div className="journey-reading">
        <div><strong>{reading}</strong><span>{readingLabel}</span></div>
        <time dateTime={new Date(current.time * 1000).toISOString()}>{timestamp}</time>
      </div>
    </figure>
  );
}

export function JourneyPanel({ journey, selectedTime, onSelectTime, onFit, loading, message }: JourneyPanelProps) {
  const points = useMemo(() => [...journey.points].sort((a, b) => a.time - b.time), [journey.points]);
  const observed = points.filter((point) => !point.estimated);
  const firstObserved = observed[0];
  const lastObserved = observed[observed.length - 1];
  const gaps = points.flatMap((point, index) => {
    const previous = points[index - 1];
    return previous && journeyTrackGap(previous, point) ? [(previous.time + point.time) / 2] : [];
  });
  const estimates = points.length - observed.length;
  const unknownAltitudes = points.filter((point) => point.altitude_ft === null).length;
  const landed = journey.status === "arrived";
  const regional = journey.status === "regional";
  const intended = regional ? null : journey.plannedDestination;
  const actual = regional ? null : journey.destination;
  const comparableByIcao = actual?.icao && intended?.icao;
  const comparableByIata = actual?.iata && intended?.iata;
  const sameArrival = comparableByIcao ? actual.icao === intended.icao :
    comparableByIata ? actual.iata === intended.iata : null;
  const diverted = landed && sameArrival === false;

  return (
    <section className="journey-panel" aria-label="Flight journey">
      <header className="journey-heading">
        <h3>Flight journey</h3>
        <button type="button" className="journey-fit" onClick={onFit} disabled={points.length === 0}>
          <Scan size={14} aria-hidden="true" />
          Fit journey
        </button>
      </header>
      <p className="journey-source">
        <span>{regional ? "Regional observations" : "Confirmed flight leg"}</span>
        {journey.source && <> · <span>{journey.source}</span></>}
        {diverted && <> · <span className="journey-diverted">Diverted</span></>}
      </p>
      <dl className="journey-route">
        <AirportEndpoint label="Departure" airport={regional ? null : journey.origin} time={regional ? null : journey.departureTime} />
        <AirportEndpoint label={landed ? "Arrival" : "Intended arrival"} airport={actual ?? (!landed ? intended ?? null : null)}
          time={landed ? journey.arrivalTime : null} />
        {landed && intended && sameArrival !== true &&
          <AirportEndpoint label="Originally intended arrival" airport={intended} fullWidth />}
      </dl>
      {loading && <p className="journey-message" role="status">Looking up the flight leg…</p>}
      {message && <p className="journey-message">{message}</p>}
      {points.length > 0 ? (
        <>
          <AltitudeChart points={points} gaps={gaps} selectedTime={selectedTime} onSelectTime={onSelectTime} />
          <ul className="journey-coverage" aria-label="Track coverage">
            <li>{observed.length} observed {observed.length === 1 ? "position" : "positions"}</li>
            {estimates > 0 && <li>{estimates} estimated {estimates === 1 ? "position" : "positions"}</li>}
            {gaps.length > 0 && <li>{gaps.length} track {gaps.length === 1 ? "gap" : "gaps"}</li>}
            {unknownAltitudes > 0 && <li>{unknownAltitudes} {unknownAltitudes === 1 ? "altitude" : "altitudes"} unavailable</li>}
            {!regional && journey.departureTime != null && firstObserved && firstObserved.time > journey.departureTime && (
              <li>Observations begin after departure.</li>
            )}
            {landed && journey.arrivalTime != null && lastObserved && lastObserved.time < journey.arrivalTime && (
              <li>Observations end before arrival.</li>
            )}
          </ul>
        </>
      ) : <p className="journey-message">No track positions available.</p>}
    </section>
  );
}

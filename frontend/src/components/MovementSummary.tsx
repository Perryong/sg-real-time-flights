import type { MovementCounts } from "../data/types";

const dateFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Singapore',day:'numeric',month:'short'});
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit'});
const duration = (seconds:number) => `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;

export default function MovementSummary({counts,now,connected,onDemand}:{onDemand?:boolean;counts?:MovementCounts|null;now:number;connected:boolean}) {
  if(onDemand) return <section className="movement-summary" aria-label="Changi daily movements">
    <div className="movement-heading"><strong>LIVE WHILE VIEWING</strong><span>15s updates</span></div>
    <p>Daily landing and takeoff counts are unavailable in this mode. Use the official Changi flight boards below for arrivals and departures.</p>
  </section>;
  const current = counts?.day === dayFormat.format(new Date(now*1000));
  const ready = current && counts?.available && counts.first_observed_at !== null;
  const paused = !connected || counts?.last_observed_at == null || now-counts.last_observed_at > 60;
  return <section className="movement-summary" aria-label="Changi daily movements">
    <div className="movement-heading"><strong>CHANGI TODAY</strong><span>{dateFormat.format(new Date(now*1000))} · SGT</span></div>
    <div className="movement-counts">
      <div><strong aria-label="Detected landings">{ready ? counts.landings : '—'}</strong><span>Landings detected</span></div>
      <div><strong aria-label="Detected takeoffs">{ready ? counts.takeoffs : '—'}</strong><span>Takeoffs detected</span></div>
    </div>
    <details>
      <summary>{ready ? paused ? 'Updates paused · saved estimates' : 'Estimated · partial coverage' : counts?.available === false ? 'Counts unavailable' : 'Waiting for today’s observations'}</summary>
      <p>Detected runway air/ground transitions, not official airport totals. Missing ground signals can miss flights. No detections does not mean no flights.</p>
      {ready && <p>Monitoring since {timeFormat.format(new Date(counts.first_observed_at!*1000))} SGT. Feed observed: {duration(counts.observed_seconds)}. Unmonitored today: {duration(Math.max(counts.unmonitored_seconds, now-Date.parse(`${counts.day}T00:00:00+08:00`)/1000-counts.observed_seconds))}.</p>}
      <p>Counts are saved by the collector. Earlier flights are not backfilled; feed availability does not guarantee complete airport coverage.</p>
    </details>
  </section>;
}

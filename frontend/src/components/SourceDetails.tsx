import { COVERAGE_RADIUS_NM } from "../data/coverage";
import { useEffect, useRef } from "react";
import { X, ExternalLink, Layers3 } from "lucide-react";
import type { Airport, FeedStatus } from "../data/types";
export default function SourceDetails({
  airport,
  status,
  transport,
  onClose,
}: {
  airport: Airport | null;
  status?: FeedStatus;
  transport: string;
  onClose: () => void;
}) {
  const ground = status?.sources?.opensky;
  const regional = status?.sources?.flyitalyadsb;
  const primary = status?.sources?.["adsb.fi"];
  const primarySuccess = primary ? primary.last_success : status?.last_success;
  const primaryRetry = primary ? primary.next_retry : status?.next_retry;
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () =>
      Array.from(
        box.current?.querySelectorAll<HTMLElement>("button,a[href]") ?? [],
      );
    buttons()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = buttons();
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    box.current?.addEventListener("keydown", trap);
    return () => {
      box.current?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Sources and accuracy"
        className="sources-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-kicker">
          <span>
            <Layers3 size={14} /> SOURCES & ACCURACY
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close sources"
          >
            <X size={18} />
          </button>
        </div>
        <h2>
          A geographic view.
          <br />
          An honest picture.
        </h2>
        <p>{airport?.caveat ?? "Airport source information is loading."}</p>
        <div className="source-card">
          <h3>Aircraft observations</h3>
          <dl className="feed-inspection">
            <div>
              <dt>Transport</dt>
              <dd>{transport}</dd>
            </div>
            <div>
              <dt>Upstream</dt>
              <dd>{primary ? `ADSB.fi · ${primary.state}` : status?.upstream_state ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Last successful response</dt>
              <dd>
                {primarySuccess != null
                  ? new Date(primarySuccess * 1000).toISOString()
                  : "None"}
              </dd>
            </div>
            <div>
              <dt>Next retry</dt>
              <dd>
                {primaryRetry != null
                  ? new Date(primaryRetry * 1000).toISOString()
                  : "Not scheduled"}
              </dd>
            </div>
          </dl>
          {primary?.error_code && <p>Access notice: {primary.error_code}</p>}
          <p>
            Live observations are provided by ADSB.fi for personal, non-commercial
            use. The search covers {COVERAGE_RADIUS_NM} nautical miles around Changi,
            including Singapore and nearby Malaysian and Indonesian airspace.
            All aircraft with usable reported positions are included, regardless
            of airline or callsign. This is not a complete aircraft census:
            coverage depends on receivers, particularly on the ground.
            Live failures never enable demo traffic.
          </p>
          <a href="https://adsb.fi/" target="_blank" rel="noreferrer">
            ADSB.fi <ExternalLink size={12} />
          </a>
        </div>
        <div className="source-card">
          <h3>FlyItalyADSB · Regional supplement</h3>
          <p>{regional?.enabled ? `FlyItalyADSB · ${regional.state}` : "FlyItalyADSB is disabled"}</p>
          {regional?.enabled && <dl className="feed-inspection">
            <div><dt>Last successful response</dt><dd>{regional.last_success == null ? "None" : new Date(regional.last_success * 1000).toISOString()}</dd></div>
            <div><dt>Next check</dt><dd>{regional.next_retry == null ? "Not scheduled" : new Date(regional.next_retry * 1000).toISOString()}</dd></div>
            {regional.error_code && <div><dt>Source notice</dt><dd>{regional.error_code}</dd></div>}
          </dl>}
          <p>When enabled, FlyItalyADSB checks the same 100 NM area every 30 seconds.
            Aircraft appear once using the newest reported position. Ground aircraft
            are included when reported; this is not a complete parking inventory.</p>
          <a href="https://flyitalyadsb.com/" target="_blank" rel="noreferrer">FlyItalyADSB <ExternalLink size={12} /></a>
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">Data: CC BY-SA 4.0 <ExternalLink size={12} /></a>
        </div>
        <div className="source-card">
          <h3>OpenSky · Changi ground supplement</h3>
          <p>{ground?.error_code === "permission_required"
            ? "Waiting for OpenSky use permission"
            : ground?.error_code === "credentials_required"
              ? "Waiting for OpenSky credentials"
              : ground?.enabled ? `Source status: ${ground.state}` : "OpenSky is disabled"}</p>
          {ground?.enabled && <dl className="feed-inspection">
            <div><dt>Last successful response</dt><dd>{ground.last_success == null ? "None" : new Date(ground.last_success * 1000).toISOString()}</dd></div>
            <div><dt>Next check</dt><dd>{ground.next_retry == null ? "Not scheduled" : new Date(ground.next_retry * 1000).toISOString()}</dd></div>
            <div><dt>Remaining daily credits</dt><dd>{ground.remaining_credits ?? "Unknown"}</dd></div>
            {ground.error_code && <div><dt>Source notice</dt><dd>{ground.error_code}</dd></div>}
          </dl>}
          <p>When enabled, OpenSky checks the Changi airport area at most once every 30 seconds.
            Only reported ground positions with a known aircraft category, up to two minutes old, are included; newer ADSB.fi
            positions take precedence. This does not identify every parked aircraft:
            aircraft without a received position remain absent.</p>
          <a href="https://opensky-network.org/" target="_blank" rel="noreferrer">OpenSky Network <ExternalLink size={12} /></a>
        </div>
        <div className="source-card">
          <h3>Airport & map geometry</h3>
          <p>
            {airport?.edition}. Authoritative CAAS verification remains pending.
            Building masses and height placement are approximations. No runway
            is claimed to be operational.
          </p>
          {airport?.sources.map((s) => (
            <a key={s.name} href={s.url} target="_blank" rel="noreferrer">
              {s.name} <span>{s.license}</span>
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
        <div className="source-card">
          <h3>Observed, estimated, simulated</h3>
          <p>
            Position source and display method are separate. Interpolation uses
            a 10-second buffer and never spans gaps over 20 seconds. Prediction
            is off. Flight phases are estimates with evidence, not confirmed
            events. The demo contains only synthetic flights.
          </p>
        </div>
        <p className="fine-print">
          For exploration and education. Not for navigation or operational
          decisions.
        </p>
      </section>
    </div>
  );
}

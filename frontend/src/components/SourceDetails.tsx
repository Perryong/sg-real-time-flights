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
              <dd>{status?.upstream_state ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Last successful response</dt>
              <dd>
                {status?.last_success
                  ? new Date(status.last_success * 1000).toISOString()
                  : "None"}
              </dd>
            </div>
            <div>
              <dt>Next retry</dt>
              <dd>
                {status?.next_retry
                  ? new Date(status.next_retry * 1000).toISOString()
                  : "Not scheduled"}
              </dd>
            </div>
          </dl>
          <p>
            Live observations are provided by ADSB.fi for personal, non-commercial
            use. Coverage depends on available receivers, particularly on the
            ground. Live failures never enable demo traffic.
          </p>
          <a href="https://adsb.fi/" target="_blank" rel="noreferrer">
            ADSB.fi <ExternalLink size={12} />
          </a>
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

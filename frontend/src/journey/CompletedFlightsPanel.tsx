import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  defaultCallsign: string;
  loading: boolean;
  message?: string;
  result?: { callsign: string; date: string };
  children?: ReactNode;
  onSearch: (callsign: string, date: string) => void;
  onEdit: () => void;
  onClose: () => void;
}

export function CompletedFlightsPanel({ defaultCallsign, loading, message, result, children, onSearch, onEdit, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const showingResult = Boolean(result);
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [showingResult]);
  const now = new Date();
  const previousDate = (days: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
  const yesterday = previousDate(1);

  return (
    <section id="completed-flights" ref={panel} className="details-panel completed-flights panel" aria-label="Completed flights">
      <header className="completed-flights-heading">
        <div>
          <h2 ref={heading} tabIndex={-1}>{result?.callsign ?? "Completed flights"}</h2>
          {result && <p>Completed flight · <time dateTime={result.date}>{result.date} UTC</time></p>}
        </div>
        {result && <button type="button" className="completed-flight-edit" onClick={onEdit}>Edit search</button>}
        <button type="button" className="icon-button" aria-label="Close completed flights" onClick={onClose}><X size={16} /></button>
      </header>
      <div hidden={showingResult}>
        <p id="completed-date-help">Search by the leg’s start date in the previous seven UTC days.</p>
        <form className="completed-flight-form" onSubmit={event => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          onSearch(String(values.get("callsign")), String(values.get("date")));
        }}>
          <label>Callsign
            <input name="callsign" defaultValue={defaultCallsign} required autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SIA638" />
          </label>
          <label>UTC date
            <input type="date" name="date" aria-describedby="completed-date-help" min={previousDate(7)} max={yesterday} defaultValue={yesterday} required />
          </label>
          <button type="submit" className="primary-button">Find flight</button>
        </form>
      </div>
      <p className="completed-flight-feedback" role="status">{loading ? "Searching the receiver archive…" : message}</p>
      {children}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { journeyUrl } from "../data/hosting";
import type { Track } from "../data/types";
import type { Airport, Journey, JourneyPoint } from "../journey/types";

export function regionalJourney(track: Track): Journey {
  const latest = track.latest;
  const byTime = new Map<number, JourneyPoint>();
  for (const sample of [...track.history, latest]) {
    if (sample.position_time === null || sample.id !== latest.id ||
        sample.session_id !== latest.session_id || sample.callsign !== latest.callsign) continue;
    const meters = sample.alt_baro_m ?? sample.alt_geom_m;
    byTime.set(sample.position_time, {
      time: sample.position_time, lat: sample.lat, lon: sample.lon,
      altitude_ft: meters === null ? null : Math.round(meters / 0.3048), estimated: false,
    });
  }
  return {
    id: track.id, callsign: latest.callsign ?? latest.provider_id, status: "regional",
    origin: null, destination: null,
    source: latest.mode === "simulated" ? "Simulated observations" : latest.provider,
    points: [...byTime.values()].sort((a, b) => a.time - b.time),
  };
}

function lookupParams(track: Track) {
  const { callsign, mode, provider_id, position_time } = track.latest;
  if (mode !== "live" || !callsign?.trim() || position_time === null || !/^[a-f0-9]{6}$/i.test(provider_id)) return null;
  return new URLSearchParams({
    callsign: callsign.replace(/\s/g, "").toUpperCase(), observed_at: String(Math.floor(position_time)), hex: provider_id.toLowerCase(),
  });
}

type Lookup = { anchor: Track; journey: Journey | null; message?: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const epoch = (value: unknown): value is number => typeof value === "number" && value > 0 && value < 1e11;
const coordinate = (value: unknown, limit: number) => typeof value === "number" && Math.abs(value) <= limit;
function airport(value: unknown): value is Airport | null {
  return value === null || (record(value) &&
    ["name", "city", "icao", "iata"].every(key => value[key] === null || typeof value[key] === "string"));
}
function confirmedJourney(value: unknown): value is Journey {
  return record(value) && (value.status === "airborne" || value.status === "arrived") &&
    typeof value.id === "string" && typeof value.source === "string" && typeof value.callsign === "string" &&
    airport(value.origin) && airport(value.destination) && (value.plannedDestination == null || airport(value.plannedDestination)) &&
    [value.departureTime, value.arrivalTime].every(time => time == null || epoch(time)) &&
    Array.isArray(value.points) && value.points.every(point => record(point) && epoch(point.time) &&
      coordinate(point.lat, 90) && coordinate(point.lon, 180) && typeof point.estimated === "boolean" &&
      (point.altitude_ft === null || Number.isFinite(point.altitude_ft)));
}

const wallClock = () => Date.now() / 1000;

export function useJourney(track: Track | null, singapore: boolean, now = wallClock, inRegion = true) {
  const regionalContact = useRef(inRegion);
  useEffect(() => { regionalContact.current = inRegion; }, [inRegion]);
  const latestTrack = useRef(track);
  useEffect(() => { latestTrack.current = track; }, [track]);
  const [anchor, setAnchor] = useState(track);
  const [previous, setPrevious] = useState(track);
  const [result, setResult] = useState<Lookup | null>(null);
  const [point, setPoint] = useState<{ anchor: Track | null; time: number; request: number } | null>(null);
  if (track !== previous) {
    setPrevious(track);
    // A receiver session can restart during a flight. A different aircraft, callsign,
    // or a long absence needs a new dated lookup, even when the ICAO address is reused.
    const registration = track?.latest.registration?.replace(/[-\s]/g, "").toUpperCase();
    const priorRegistration = (previous?.latest.registration ?? anchor?.latest.registration)?.replace(/[-\s]/g, "").toUpperCase();
    if (!track || !previous || track.id !== previous.id || track.latest.mode !== previous.latest.mode ||
        (previous.latest.position_time === null && track.latest.position_time !== null) ||
        track.latest.callsign?.trim().toUpperCase() !== previous.latest.callsign?.trim().toUpperCase() ||
        (registration && priorRegistration && registration !== priorRegistration) ||
        (previous.latest.ground === true && track.latest.ground === false) ||
        Math.abs(track.latest.receipt_time - previous.latest.receipt_time) > 2 * 3600 ||
        (result?.anchor === anchor && result?.journey?.arrivalTime != null &&
         track.latest.ground === false && track.latest.receipt_time > result.journey.arrivalTime + 15 * 60)) {
      setAnchor(track);
    }
  }

  useEffect(() => {
    if (!anchor || !singapore) return;
    if (!lookupParams(anchor)) return;
    let pinned: URLSearchParams | null = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let confirmed: Journey | null = null;
    async function refresh() {
      if (!anchor || controller.signal.aborted) return;
      const latest = latestTrack.current;
      const params = pinned ?? (latest && lookupParams(latest));
      let retry = true;
      if (!document.hidden && params && (pinned || now() - Number(params.get("observed_at")) <= 180)) {
        try {
          const response = await fetch(`${journeyUrl}?${params}`, { signal: controller.signal, credentials: "omit", cache: "no-store" });
          if (!response.ok) throw Error();
          const { journey, reason, retryable } = await response.json();
          if (controller.signal.aborted) return;
          if (journey === undefined) throw Error();
          if (journey !== null) {
            if (!confirmedJourney(journey) || journey.callsign !== params.get("callsign") ||
                (confirmed && journey.id !== confirmed.id)) throw Error();
            confirmed = journey;
            params.set("id", journey.id);
            pinned = params;
          }
          if (!journey && retryable !== true) confirmed = null;
          setResult({ anchor, journey: confirmed, message: typeof reason === "string" ? reason : undefined });
          retry = journey?.status === "airborne" || retryable === true;
        } catch {
          if (controller.signal.aborted) return;
          setResult({ anchor, journey: confirmed,
            message: confirmed ? "Journey update unavailable. Showing the last received track." : "Flight history is temporarily unavailable." });
        }
      }
      if (retry) timer = setTimeout(refresh, regionalContact.current ? 300_000 : 1_800_000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [anchor, singapore, now]);

  const regional = useMemo(() => track ? regionalJourney(track) : null, [track]);
  const current = singapore && result?.anchor === anchor ? result : null;
  return {
    journey: current?.journey ?? regional,
    loading: !current && !!anchor && singapore && !!lookupParams(anchor),
    message: current?.message,
    selectedTime: point?.anchor === anchor ? point?.time ?? null : null,
    locateRequest: point?.anchor === anchor ? point?.request : undefined,
    selectTime: (time: number) => setPoint(previous => ({ anchor, time, request: (previous?.request ?? 0) + 1 })),
  };
}

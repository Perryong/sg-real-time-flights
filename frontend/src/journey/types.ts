export interface Airport {
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export interface JourneyPoint {
  time: number;
  lat: number;
  lon: number;
  altitude_ft: number | null;
  estimated: boolean;
  gapBefore?: boolean;
}

export interface Journey {
  id: string;
  callsign: string;
  status: "airborne" | "arrived" | "completed" | "regional";
  origin: Airport | null;
  destination: Airport | null;
  plannedDestination?: Airport | null;
  source: string;
  points: JourneyPoint[];
  departureTime?: number | null;
  arrivalTime?: number | null;
}

const JOURNEY_GAP_SECONDS = 15 * 60;

export function journeyTrackGap(previous: JourneyPoint, next: JourneyPoint) {
  return next.gapBefore === true || next.time - previous.time > JOURNEY_GAP_SECONDS;
}

export function journeySegmentBreak(previous: JourneyPoint, next: JourneyPoint) {
  return previous.estimated || next.estimated || journeyTrackGap(previous, next);
}

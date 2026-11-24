import type { Mode } from "./types";

export const staticHost = import.meta.env.VITE_STATIC_HOST === "true";
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
let backend = "";
try {
  const url = new URL(configured);
  if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash)
    backend = url.href.replace(/\/$/, "");
} catch { /* No hosted backend configured. */ }
export const liveAvailable = !staticHost || !!backend;
export const airportUrl = staticHost ? assetUrl("data/airport.json") : "/api/airport";
export const fixtureUrl = (mode: Mode) => {
  const name = mode === "simulated" ? "changi-demo" : "recorded-test";
  return staticHost ? assetUrl(`data/${name}.json`) : `/api/fixtures/${name}`;
};
export function socketUrl(origin: string): string | null {
  if (!liveAvailable) return null;
  const url = new URL(`${backend || origin}/ws/aircraft`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const httpFeedUrl = liveAvailable && import.meta.env.VITE_LIVE_TRANSPORT === "http"
  ? `${backend}/api/aircraft` : null;

export const postalSearchUrl = `${backend}/api/location/postal`;

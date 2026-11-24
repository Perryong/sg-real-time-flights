# Wind and rain radar implementation plan

> For agentic workers: use superpowers:executing-plans for the assigned task, with tests before new behavior.

Goal: implement approved Issue #7 as independent Singapore surface-wind and rain-radar toggles in Cesium, retaining free cloud hosting.
Spec: https://github.com/Perryong/sg-real-time-flights/issues/7 . User requested implementation after reviewing the issue. Proceed within the established branch, review, push, merge and deploy workflow.

Architecture: Vercel exposes GET /api/weather?layer=wind|radar, backed by a separate atomic Redis cache/lease and request limits. Only enabled layers poll (wind60s, radar300s), hidden tabs pause, no background collector. Cesium draws actual station wind arrows with animated pulses (static in reduced-motion mode), and a non-interactive geographic raster radar overlay. Surface wind is not aircraft-altitude weather. Both toggles start off; remember preferences for the browser session. No new rendering library or paid service.

Contract (UTC epoch seconds):
- Wind: {layer:'wind', state:'fresh'|'stale'|'unavailable', observed_at:number|null, fetched_at:number|null, retry_after:number, message:string|null, stations:[{id:string,name:string,lat:number,lon:number,speed_mps:number,from_deg:number}]}
- Radar: same envelope with layer:'radar', radar:null|{url:string,west:number,south:number,east:number,north:number,observed_at:number,expires_at:number}. URL is HTTPS from official allowlisted image host, never arbitrary client-supplied URL. Expired/stale imagery is not shown as fresh. All readers validate at the boundary.
- HTTP400 invalid queries,429 quota with Retry-After,503 coordinated provider/cache unavailable with Retry-After. A stale cached envelope may be returned with explicit state and timestamps. 401/403 must not trigger bypass/retry storms.

Global constraints: initial Singapore coverage only; preserve aircraft/pin/follow behavior and fixed base-imagery indices; no weather during synthetic/recorded playback (label live weather unavailable in demo); do not reintroduce daily counters; document attribution and finite free quotas. Radar70km coverage, wind actual stations only (no invented winds/interpolation outside support). Reference used as UX and data-source guidance; copy no third-party application code.

Review focus: stale/expired or missing data, independent toggle races, old requests after region/visibility changes, meteorological from/to conversion, GPU/listener cleanup and reduced motion, provider denial and cache concurrency, daily/monthly quota protection.

## Tasks
- [x] Backend: weather.py + tests; normalize/join official feeds with unit/time/coordinate validation; Redis atomic coordination, bounded requests, backoff, expired signed URLs; mount router in local/cloud apps. Record real provider access outcome. Owner backend worker.
- [x] Renderer: frontend/src/scene/weather.ts + tests; independent Cesium radar/station arrows, animation and cleanup, protected base map indices. Owner renderer worker.
- [x] Frontend: typed contract/poll hook, session toggles, accessible compact weather controls and legends, timestamps, opacity, coverage/demo/error labels; App/MapScene/SourceDetails wiring. Owner root.
- [x] Verify: normal/missing/denied/429/expired states; desktop/mobile and follow/pin regression; real-data screenshot, baseline/layers performance; full suites/build; independent review.
- [ ] Publish: safely package/deploy Vercel backend, verify endpoints; commit/push PR closing#7; merge and check Pages/public UI. No secrets in source or build.

Provider discovery: local Python urllib request returned403/error1010; official docs say APIs are public without keys for testing, recommend free API keys in production. Do not bypass provider denial. Verify normal server client/deployment access; expose truthful unavailable status if permission is required.

Implementation access result: ordinary httpx requests and the deployed Vercel endpoint returned HTTP200 without a key. Fresh paired wind observations and radar metadata verified. See docs/weather-verification.md for checks and quota limitations.

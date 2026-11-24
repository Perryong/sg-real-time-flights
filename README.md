# Changi Observatory

A geographic Singapore Changi flight tracker built with React, TypeScript, CesiumJS and FastAPI. Start with a north-up regional map, tilt into 3D, inspect aircraft, follow tracks, and explore sourced airport geometry.

**Release status: personal local tracker with ADSB.fi, an optional FlyItalyADSB supplement, and Cesium 3D.** The source distribution leaves live polling off until personal use is configured below. Live mode shows only received observations; **Demo** separately explores 16 explicitly labeled synthetic aircraft. Airport geometry and flight-phase estimates remain provisional.

![Synthetic geographic tracker preview](docs/evidence/overview.png)

## Run locally

Tested on macOS arm64 with **Node 26.13.0 / npm 11.20.0 / Python 3.13.14**. Runtime selectors and exact dependency lockfiles are included. Linux is expected to work but has not been verified; Windows compatibility has not been verified.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
(cd frontend && npm ci)
./scripts/dev.sh
```

Open **http://127.0.0.1:5177**. Backend: **http://127.0.0.1:8017/api/health**. These ports deliberately avoid other services already running on the original development machine. The start script stops only its own backend on exit.

Alternatively, use two terminals from the project root:

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8017 --env-file .env
npm --prefix frontend run dev
```

For a production bundle locally, keep the backend running, then:

```sh
npm --prefix frontend run build
npm --prefix frontend run preview
```

Preview serves http://127.0.0.1:4177 and proxies `/api` and `/ws` to port 8017. Do not run multiple backend workers: each process would own an upstream poller. Hosted live traffic requires a separate HTTPS/WSS backend and explicit origin configuration; see the GitHub Pages section below.

## GitHub Pages

Public site: https://perryong.github.io/sg-real-time-flights/

GitHub Pages serves the Cesium interface, airport geometry and an explicitly synthetic demo. The live backend runs on **Vercel Hobby**, with **Upstash Redis Free** for shared snapshots and request coordination. Your Mac is not required for the hosted tracker.

The browser fetches live snapshots every 15 seconds while the tab is visible. Hidden tabs pause requests. This is on-demand viewing, not continuous collection. Daily detected landing/takeoff counts persist in the shared cloud state, but new events are collected only while someone views the tracker. Hidden or closed browsers do not trigger collection. Positions keep their provider timestamps, and stale or unavailable feeds never switch to synthetic data. Cesium 3D, aircraft selection, source attribution and historical route labels remain available.

### Free cloud deployment

Project: `perrymikes-projects/sg-changi-feed-test` (the name is retained from the compatibility test). Backend: `https://sg-changi-feed-test.vercel.app`. Database: `changi-flight-cache`, Singapore, plan `free`, `autoUpgrade=false`, `prodPack=false`. Do not enable paid upgrades. Upstash Free includes 500,000 commands and 10 GB transfer per month at setup time; Vercel Hobby quotas also apply across your account. Free quotas are finite: exhaustion can temporarily stop live updates. No daemon, scheduled collector or paid plan is configured.

`deploy/vercel/package.py` exports only allowlisted public source into a temporary folder. Deploy that folder with Vercel CLI; never upload the repository root, `.env`, private runtime database, downloaded cloud environment files or credentials. The deployment uses Python 3.13, the Singapore runtime region and a 30-second maximum request duration. `backend/app/cloud.py` is the cloud application; the existing `backend/app/main.py` remains the local WebSocket server.

Required private Vercel production variables: `FLYITALYADSB_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`. The Upstash integration supplies Redis credentials. Set `LIVE_ENABLED=true`, `ADSBFI_PERSONAL_USE=true`, and `FLYITALYADSB_ENABLED=true`. OpenSky remains disabled. Store secrets through Vercel's environment settings or private stdin, never source files or frontend variables.

GitHub Actions variables are public configuration only:
- `LIVE_BACKEND_URL=https://sg-changi-feed-test.vercel.app`
- `LIVE_TRANSPORT=http`

The Pages workflow builds both into the frontend. After changing either, rerun **Publish Changi Observatory**. For local WebSockets, leave `VITE_LIVE_TRANSPORT` unset.

### Shared cache and limits

Redis atomically grants one 35-second refresh lease across all server instances. A successful refresh is shared for 15 seconds; Vercel CDN can additionally reuse its HTTP response for five seconds. ADSB.fi polling is limited to at most one request every 15 seconds, FlyItalyADSB to one every 30 seconds, regardless of viewer count. Providers' retry deadlines and access-denial pauses survive instance restarts. A conservative five-minute reservation protects in-flight provider attempts if a refresh crashes.

Origin requests have fixed-minute limits of eight per hashed viewer address and 60 globally. Throttled viewers do not consume the remaining global allowance; CDN hits do not reach these counters. Errors return `Retry-After: 60`. The browser preserves retry delays across tab switches. This is a personal-use quota guard, not unlimited traffic capacity. If Redis is unavailable, the backend fails closed instead of querying providers without coordination.

The shared state contains compressed observations and up to 12 history samples per track. There is no durable local database on Vercel. Each refresh restores the minimal movement ledger into memory and commits it with the snapshot under the same Redis lease, without extra Redis requests. Saved events and coverage survive new instances and browser closure; cache hits never increment counts. Ledger retention is seven Singapore calendar days, pruned during refresh. Expired leases cannot publish totals. A separate response-time header plus CDN age corrects browser clock skew without making old positions look fresh.

### Recovery and local fallback

A provider 401/403 pause is intentionally persistent. Correct the credentials first, then set `CLOUD_CACHE_VERSION` to a new value (for example `v2`) and redeploy to start an isolated cache namespace. This resets cached tracks, retry state and saved daily movement counts; preserve the old namespace if its counters are needed, and never present a reset as complete daily coverage; do not use it to bypass a provider's access denial or quota. Old state can be removed later from this application's Redis namespace only. For exhausted free quotas, wait for the service's quota reset rather than upgrading automatically.

The previous Mac LaunchAgents (`com.changi-observatory.backend` and `com.changi-observatory.tunnel`) are retained as a local fallback and disabled after cloud verification. Their private logs and `.env` remain on the Mac. To run locally, use `scripts/dev.sh`. Restarting the old Cloudflare tunnel changes its temporary hostname and does not update the hosted tracker automatically.

## Likely arrivals, departures and historical routes

The live Traffic panel has a **Changi direction** dropdown for likely inbound, likely outbound and unknown/other aircraft. Flight rows and selected details show the usual route when supplied by FlyItalyADSB. `?with=route` adds historical route metadata to the existing 500 km request; no additional account, request loop or paid plan is used. Route data is credited separately from the source supplying the newest position.

A likely inbound label requires a route ending at WSSS and a course within 60 degrees toward Changi. A likely outbound label requires a route starting at WSSS and a course within 60 degrees away. Both require a fresh (at most 20 seconds) airborne report, speed at least 30 m/s, matching callsign and route data retrieved within five minutes with an observation day within the last seven UTC days. Within 1 km of the airport centre or beyond 500 km, intent remains unknown. A turn, stale data or missing evidence can return a flight to unknown. Existing runway approach/climb estimates are separate.

These labels are not confirmed flight plans, destinations, airport arrival times or proof that a flight took off from Changi today. Callsigns can serve different routes. Historical route evidence cannot increase detected movement counters. Route metadata matches ICAO identity and callsign across sources, and updates cannot renew a position timestamp. Malformed, old or future route evidence is ignored. Demo is isolated from live route filters.

**Schedules & gates** links open Changi’s official arrivals/departures boards. No website credentials or private Changi service is copied into the application, and no schedule, gate, boarding status or exact ETA is fabricated.

## Today’s detected Changi movements

The live Traffic panel shows **Landings detected** and **Takeoffs detected** for the current Singapore calendar day. These are conservative estimates, not official airport totals or counts of all flights in Singapore. Two airborne reports followed by two ground reports, with deceleration and a moving ground position aligned near a Changi runway, support a landing. The reverse transition with repeated climb supports a takeoff. Each adjacent report must be at most 20 seconds apart and use the same identity, source and track session. Unknown ground states, overflights, taxiing and disappearing tracks do not count. Runway geometry remains provisional, and brief repeated detections are deduplicated.

Counts begin when this update starts collecting; earlier flights are not backfilled. Free-source ground coverage can be sparse, so zero detected movements does not mean no flights occurred. Expand **Detected today · partial coverage** (cloud) or **Estimated · partial coverage** (local) to see the monitoring start time, successful feed sampling intervals and unmonitored time since Singapore midnight. Gaps and failed feed periods are excluded from observed intervals. Cloud instances preserve continuity only for successive successful samples at most 20 seconds apart; local collector restarts break continuity; feed availability still does not guarantee aircraft coverage. Disconnected clients retain saved estimates with a paused notice; yesterday’s counts are never presented as today’s.

The cloud keeps minimal event identity/type/time, daily coverage and continuity timestamps in private shared Redis state. Only today’s aggregate counts are public. Summaries roll over at Singapore midnight, including cached responses, and display unmonitored time. Malformed saved ledger state makes a cloud refresh unavailable rather than silently resetting counts. There is no migration of historical Mac counts or backfill.

For the optional local collector, minimal event identity/type/time and daily coverage are stored in ignored `runtime/movements.sqlite3` on the Mac, retained for seven calendar days. No raw aircraft positions or credentials are stored in this database or published to GitHub; only today’s aggregate summary is served. Counts survive backend restarts. Set backend `MOVEMENT_DB_PATH` to change the storage location. Storage failure shows counts unavailable while the aircraft map continues. Demo/recorded playback never updates or displays live daily counts.

## Explore

- **Live / Demo:** explicit mode choice. Failure never switches to demo. Demo is an original synthetic scenario, with its own clock and identifiers; it contains no real flights or schedules.
- **Traffic:** search by callsign, provider identifier or registration, then select an aircraft. `/` focuses search. Aircraft remain readable without WebGL.
- **Follow:** camera tracking; Escape exits. Follow stops if the selected track is lost.
- **3D / 2D:** tilt or return to overhead. Zoom, north reset, regional overview and named runway views are available.
- **Layers:** airport geometry and selected-aircraft trails. Solid trail segments and points are past observations; the dashed segment is display interpolation. These remain simulated in demo mode.
- **Day / night:** presentation only, independent of observation time. Map colors are adapted locally; this is not observed airport lighting.
- **Playback:** pause, seek and restart the bundled scenario. Pausing freezes scenario time and expiry. The read-only `/api/fixtures/recorded-test` endpoint provides a synthetic recorded-contract fixture for tests, not a historical flight service.
- **Sources & accuracy:** geometry provenance, upstream/transport status, last successful response and next retry. Selected details show the original position date/time, altitude reference, timing, display method and inference reasons.

On mobile the aircraft panel starts collapsed so the map stays visible. Use Traffic to open it. Satellite imagery, confirmed schedules/destinations, weather, account features and global aircraft coverage are not implemented. Historical routes and likely Changi direction estimates are available when evidence supports them.

## Live configuration

Copy `.env.example` to `.env` if configuration is needed. `scripts/dev.sh` loads it only into the backend. No provider secret belongs in a `VITE_` variable.

The user selected [ADSB.fi](https://adsb.fi/) for personal, non-commercial use. Its [public API terms](https://github.com/adsbfi/opendata) require attribution and limit requests to one per second. No account or API key is required for this geographic endpoint. Do not use this configuration for a commercial service.

For your personal tracker, set these in `.env`, then start/restart the backend:

```dotenv
LIVE_ENABLED=true
ADSBFI_PERSONAL_USE=true
POLL_SECONDS=10
```

The fixed query is `https://opendata.adsb.fi/api/v3/lat/1.3644/lon/103.9915/dist/100`. The 100 NM (185.2 km) radius includes Singapore and surrounding Malaysian/Indonesian airspace. All usable reported aircraft positions are accepted; unknown callsigns and ground aircraft are not filtered out. One shared poller serves all browser clients with a five-second timeout, minimum ten-second polling, bounded retry/backoff, `Retry-After` handling, and an automatic pause for 401/403. An optional OpenSky ground supplement is described below; no arbitrary upstream URL proxy exists. The former Airplanes.live flags are no longer used.

ADSB.fi v3 `now` is converted explicitly from milliseconds to UTC seconds. `seen_pos`/`seen` are ages in seconds; missing or invalid timing stays unknown. Altitudes retain their reported references. Live identities with a valid ICAO address use `live:icao24:<hex>` across both sources; other identifiers remain provider-specific; synthetic identities remain separate. Observations are held only in bounded process memory, not written to an aircraft archive. Receiver coverage varies, especially on airport surfaces.

## Optional OpenSky ground supplement

The OpenSky adapter is integrated; continuous use remains **off pending clarification of OpenSky live-use permission**. The account credentials are configured privately on the original development machine. The source distribution contains only empty credential placeholders.

After permission is clarified, configure `OPENSKY_ENABLED=true`, `OPENSKY_USE_CONFIRMED=true`, `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` in the backend `.env`, then restart it. Keep the existing live and personal-use flags enabled. Never put credentials into frontend variables or commit `.env`. See [OpenSky API documentation](https://openskynetwork.github.io/opensky-api/rest.html) and [terms](https://opensky-network.org/about/terms-of-use).

One shared collector queries latitude 1.30–1.40, longitude 103.965–104.03 at most every 30 seconds (up to 2,880 small-area requests/day). OAuth tokens remain in process memory and renew before expiry. Each source has independent access-denial, rate-limit and retry handling; a ground-source failure does not stop ADSB.fi. Exhausted credits suspend OpenSky requests for a conservative 24 hours. Sources & accuracy shows its state, remaining credits and retry time.

Only `on_ground=true` reports with valid airport-area positions no more than 120 seconds old are accepted. Surface vehicles, obstacles, reserved categories and contacts with no aircraft-category information are excluded. This conservative filter can omit legitimate aircraft whose category is missing. Aircraft sharing an ICAO address appear once, using the newest reported position; ADSB.fi wins ties. Source changes reset interpolation history. Cesium and the All aircraft list display these observations using the same existing aircraft rendering, with source attribution in selected details.

This is **not a parked-aircraft inventory**. Aircraft with no transmitted/received position cannot be added reliably, and an on-ground report does not confirm a landing or a parking stand. No missing positions are invented.

## Optional FlyItalyADSB regional supplement

The free FlyItalyADSB adapter adds reported aircraft within 500 km of Changi while retaining the ADSB.fi inner 100 NM (185.2 km) feed and Cesium. The overview and ring show the maximum 500 km query area; availability still depends on receivers and enabled sources. Get a free key from [FlyItalyADSB](https://flyitalyadsb.com/data/api/), place `FLYITALYADSB_API_KEY` in the private backend `.env`, set `FLYITALYADSB_ENABLED=true`, and restart the backend. Existing live/personal-use settings remain required. Never put the key in a frontend variable or commit it.

One shared collector polls every 30 seconds (at most 89,280 requests over 31 days), within the published free allowance of 300,000 requests/month and 30/minute. The radius parameter uses kilometres; response timestamps use seconds. Source health and retry state appear in Sources & accuracy. The newest source position wins for each ICAO identity, and a source change resets interpolation history. Ground reports are included when available; no parked positions are inferred. Quota/access denials stop only this source; ADSB.fi continues.

Data attribution: [FlyItalyADSB](https://flyitalyadsb.com/), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Live data stays in bounded memory and is not bundled in the source archive. This configuration is for the local tracker, not a redistributed real-time data service. [Provider terms](https://flyitalyadsb.com/terms/).

## Time and data integrity

Wire timestamps are UTC epoch seconds. The UI uses SGT for human-readable times. Source position time, provider response time, receipt time, scene lighting time and scenario time are separate.

- Position ages 0–20 seconds: fresh; >20–60: delayed; >60–120: stale; >120: lost. Missing/untrusted source time is unknown, never receipt-time freshness.
- Display buffer is ten seconds. Interpolation requires valid brackets no more than twenty seconds apart. Prediction is disabled in the UI; the pure display function supports a tested opt-in maximum of five seconds.
- Cached positions and heartbeats cannot renew observation age. Socket restarts acquire a new full snapshot, with connection/epoch/sequence checks against obsolete callbacks.
- Live store defaults to five minutes of history, a hard 301-sample cap per identity, and 1,000 identities. Lost tracks expire. Eviction and invalid-record counts are exposed.
- Phases are deterministic heuristic estimates with reasons, candidate runways, confidence and evidence times. Sparse/unknown ground coverage never confirms touchdown or takeoff. Synthetic tests demonstrate rule behavior, not real-world accuracy.

## Geometry, heights and attribution

The distributed viewer contains three runway pairs derived from **OurAirports (Unlicense)**, and **730 taxiway features / 26 building footprints from OpenStreetMap (ODbL)**. The exact source manifests and hashes live in `data/airport/manifest.json`. These are provisional community data. The authoritative CAAS coordinate/reuse gate remains unmet; no CAAS charts or copied tables are bundled, and runway operational availability remains unknown.

Terminal masses use source heights where available, otherwise clearly estimated heights. Terrain uses an ellipsoid fallback. Barometric/MSL/geometric heights are not equivalent; displayed aircraft height is approximate, raw values remain available, and model contact never supplies landing evidence. The generic aircraft is an original procedural GLB, not a verified model of each actual aircraft type.

Interactive map imagery: © OpenStreetMap contributors. The night palette is a local color adaptation of the same requested tiles. Browser caching is retained; no bulk tile downloads or prefetch. Tile availability is external. The source ZIP includes no map tiles. Required credits remain visible.

See [asset and source licenses](assets/LICENSES.md), [geometry evidence](docs/evidence/geometry.md) and [provider gate](docs/evidence/provider-contract.md).

## Verification

```sh
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
# Start both services, then:
cd frontend
npx playwright install chromium
npm run test:e2e
cd ..
PYTHONPATH=. .venv/bin/python scripts/build_fixtures.py --check
.venv/bin/python scripts/verify_airport.py
```

Load and scenario checks (synthetic; never poll upstream):

```sh
PYTHONPATH=. .venv/bin/python scripts/benchmark.py --clients 10 --duration 300
PYTHONPATH=. .venv/bin/python scripts/soak.py --duration 7200 --accelerated
# Omit --accelerated for a real-time backend soak.
npm --prefix frontend run preview
# In another terminal:
cd frontend
BENCH_CHANNEL=chrome node scripts/benchmark.mjs 300
# Omit BENCH_CHANNEL to use Playwright Chromium; record its actual renderer.
```

Measured locally: 100 synthetic aircraft averaged **59.47 actual rendered FPS** over five minutes in installed Chrome on Apple M5 Pro; ten ASGI clients received updates at **0.366 s p95**. These are configuration-specific synthetic measurements. The accelerated scenario soak does **not** establish two-hour wall-clock/browser reliability. Actual results and all unmet acceptance gates are listed in [release evidence](docs/evidence/release.md). Vite reports a large Cesium chunk; the map is lazy-loaded so status and controls can load independently.

## Source archive

```sh
.venv/bin/python scripts/package.py
```

Produces `dist/changi-observatory-source.zip` with source, tests, fixtures, lockfiles, assets, configuration example, attribution and `goal.md`. It excludes credentials, chat attachments, dependency caches and build outputs. The archive must be verified by a clean unpack/install/build/start check before handoff.

## Troubleshooting

- **No live aircraft:** check both personal-use flags and the Sources & accuracy panel. A healthy feed can report no aircraft; receiver coverage is not guaranteed. Demo is a separate synthetic walkthrough.
- **Backend disconnected:** check port 8017 and browser/proxy origin settings. The app keeps aging existing positions rather than pretending a refresh occurred.
- **Map imagery unavailable:** airport geometry and traffic controls remain available; public OSM tile service has no SLA.
- **WebGL unavailable:** use the searchable traffic list/details; try a supported browser with hardware acceleration for the 3D map.
- **Model unavailable:** the app falls back to aircraft markers and shows a notice.
- **Port in use:** stop only your prior instance or adjust the dev ports, Vite proxy and `ALLOWED_ORIGINS` together. Do not kill unrelated services.

For exploration and education. **Not for navigation or operational decisions.**

## My location and sky view

**My spot** opens a session-only Singapore location pin. Choose **Drop pin**, then tap the map; **Cancel** or Escape leaves the existing pin intact. The allowed map rectangle includes Singapore and nearby coastal waters, not an authoritative national boundary. A postal lookup accepts exactly six digits (including leading zeroes), shows exact matching OneMap addresses, and retains the previous pin if lookup fails. Closing/reloading the tab clears the pin; coordinates are not added to the URL or flight feed.

The nearby list uses fresh airborne reports within 25 km, sorted by horizontal distance, with bearing measured clockwise from north. **Sky view from pin** fixes the Cesium camera at the pin and provides heading/elevation controls and a view height of 2–500 m above the flat map. **Look at aircraft** aims at a current nearby aircraft; it does not guarantee real-world visibility. Unknown/stale altitude and below-horizon aircraft cannot be aimed at. Geometric altitude is preferred; barometric fallback is labeled approximate. The view does not model building or terrain obstruction, and aircraft models/markers are visually scaled. Sky view uses the latest fresh observation for both direction and rendering, without the map’s 10-second display buffer or historical trails. Exit sky view to restore normal map controls. Demo observations remain explicitly simulated.

Postal search uses the free OneMap Search API, which requires an account: https://www.onemap.gov.sg/apidocs/register . Configure **ONEMAP_EMAIL** and **ONEMAP_PASSWORD** privately in the Vercel production environment (and local `.env` only if using the local server); never use `VITE_` variables or commit credentials. Registration, email verification, password entry and acceptance of terms belong to the account owner. Alternatively configure **ONEMAP_ACCESS_TOKEN** as a production secret to use an existing token without storing your password. This token must be replaced when it expires; email/password configuration takes priority and renews tokens automatically. Without either configuration, postal lookup explains its unavailability and Drop pin remains functional.

`POST /api/location/postal` forwards only the explicitly submitted postal code to OneMap. OneMap token acquisition is server-side, cached privately in Redis, and protected with a short lock/backoff. Lookup responses are not stored in the shared aircraft snapshot or a location-history database. Search is limited to five requests per viewer per Redis minute and 20 globally. Missing Redis/configuration, provider denial, expired authentication (including OneMap HTTP 200 error envelopes), or quota errors fail safely. Search does not require or request GPS permission.

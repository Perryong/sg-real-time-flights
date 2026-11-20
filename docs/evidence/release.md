# Release evidence — 19 November 2026

The personal local tracker now uses ADSB.fi live observations in the existing Cesium view. The user approved this provider and personal, non-commercial use. No public deployment was made. The live browser check showed 10 tracked aircraft, nine rendered in view, healthy WebSocket updates, valid source times, 3D toggle, selection and follow/exit with no page errors. A later backend check recorded 14 shared polls, 11 tracks and up to 14 history samples. These short checks do not establish sustained or complete surface coverage. Provider evidence is in `provider-contract.md`.

## Current verification

- Python unit/integration suite: 54 passing.
- Frontend unit/component suite: 24 passing; typecheck and production build pass.
- Chromium browser suite: 11 passing after the Singapore coverage expansion (about one minute).
- Five-minute shared-service test: 100 synthetic aircraft, ten ASGI clients, 60 shared polls; p95 receipt-to-client 0.366 s. This measures an in-process ASGI transport, not deployed network latency.
- Two-hour scenario-time backend soak accelerated into 40.34 seconds: bounded identities/history, final-hour memory ratio 1.0634. This is not a two-hour wall-clock or browser soak.
- Five-minute production scene test: **59.47 rendered FPS**, p95 frame interval 18.4 ms, 17,848 actual Cesium frames, 100 entities / 100 aircraft within the geographic view at 1920×1080. Installed Chrome 157.0.8103.79 used ANGLE Metal on Apple M5 Pro (24 GB RAM). Five-minute histories were stored, with the selected aircraft's trail displayed. No page errors; retained JS heap after forced GC was 54.3 MB. This meets the 30-FPS target on this configuration, not on all devices. Routine verification and the backend benchmark ran concurrently for part of the measurement.
- The earlier SwiftShader/development result used browser RAF rather than scene frames and is retained only as a superseded diagnostic (`browser-performance-development.json`). It is not accepted scene-performance evidence. The corrected benchmark rejects induced context loss with `valid=false` and exit code 1 (`benchmark-context-loss.json`).
- Safari 26.5.2 is installed, but WebDriver rejects sessions because remote automation is disabled. No settings were changed. Safari smoke is unverified. Microsoft Edge is not installed. Installed Chrome 157.0.8103.79 passed the visual smoke on Apple M5 Pro / ANGLE Metal; cold local scene 1.253 s, warm 0.433 s. See `browser-smoke.json` and `visual.md`.

## Acceptance gates

| Gate | Status | Evidence / limit |
| --- | --- | --- |
| AC-01 reproducible install/build | Pass on macOS arm64 | Separate clean environment installed lockfiles, 45 backend + 21 frontend tests, production build; `clean-install.json` |
| AC-02 authorized live feed | Personal local integration verified; coverage partial | Public ADSB.fi terms checked, user approved personal use, actual response/stream/viewer verified; complete Changi surface coverage remains unverified |
| AC-03 authoritative thresholds | Unmet | `geometry.md`; licensed community geometry is provisional, not a source-precision exemption |
| AC-04 observation details | Pass on fixtures | Component tests; original date/time, age, altitude reference, provider, display method |
| AC-05 interpolation | Pass | Clock-controlled tests; 21-second gaps rejected |
| AC-06 bounded prediction | Pass | Disabled by default, opt-in five-second bound tested |
| AC-07 freshness | Pass | Exact boundary tests, cached-position and heartbeat/loss tests |
| AC-08 failure/recovery | Pass on mocks | Provider, stream and browser tests; no live operational validation |
| AC-09 inferred phases | Partial | Synthetic inference rules tested; real track accuracy and complete operational validation unverified |
| AC-10 follow/day/night | Pass on Chromium | Browser selection, follow, Escape, loss and lighting tests |
| AC-11 mode isolation/playback | Partial | Live/demo flows and scenario clock tests pass; recorded fixture contract exists, no public recording selector |
| AC-12 asset/height fallback | Partial | Model/WebGL failure tests; ellipsoid fallback. Terrain-provider failure is not exercised because no external terrain is configured |
| AC-13 performance/soak | Partial | 59.47 actual FPS and 0.366 s p95 ASGI delivery pass on measured configuration; accelerated scenario soak passes; two-hour wall-clock browser soak not run |
| AC-14 secrets/attribution/origins | Pass within local release scope | Archive allowlist/CRC and private-key-pattern scan; no .env/dependency cache; no provider credentials required, origin and escaping tests; licenses included |
| AC-15 source archive | Pass | Clean unpack/install/build/API/browser flow, root goal.md present; temporary services stopped |

## Scope decisions

- Started an isolated feature branch in the empty project, rather than a second worktree; no existing work was displaced.
- ADSB.fi replaces the unused Airplanes.live adapter. Local activation requires both LIVE_ENABLED and ADSBFI_PERSONAL_USE; v3 milliseconds are fixed in the adapter. No provider framework or automatic fallback was added.
- CAAS redistribution permission is unresolved. Distributed geometry comes from OSM and OurAirports with their licenses; authoritative precision remains unmet, and inference remains provisional.
- Community import consistency is tested to its own precision. The authoritative 2 m / 5 m / 0.1° targets are not waived or silently loosened.
- Demo history is 60 seconds to limit fixture size; live history remains 300 seconds. Demo trails are shorter.
- Ports 8017/5177/4177 avoid unrelated services on 8000/5173.
- Scene and interface were integrated together because camera/selection and fallback verification require the complete UI. Their browser checks remain separate.
- Clean npm installation runs inside frontend: npm 11.20 with --prefix through the macOS /var symlink gave a false lockfile mismatch; no dependencies changed.
- No merge/push/deployment is needed for this newly initialized local repository; retain `feat/changi-tracker` and the source archive.

## Review and clean installation

Independent review found six important issues; all were fixed with failing-then-passing regressions. Three minor issues remain explicitly deferred in [review.md](review.md). The original preview suite was 45 Python tests, 21 frontend tests and 8 browser tests. ADSB.fi verification above supersedes those counts. Typecheck and production build pass.

The source archive was extracted to a separate temporary directory. Python dependencies were installed into a new virtual environment and npm ci succeeded from the frontend directory. The extracted application passed its tests/build, all four API checks, explicit demo selection, pause and mode-isolation checks with map imagery blocked. Temporary ports 8027/4187 and corresponding temporary proxy/origin settings avoided the running app. No dependency versions were changed. After final evidence-only updates, packaging rechecks the archive contents and CRC.

## Remaining validation

The local live integration is verified by a short smoke check, not a long-term feed SLA, authoritative airport digital twin, universally performant application, or two-hour stability-certified release. The 30-FPS result applies only to the measured Chrome/M5 Pro configuration. Complete provider/geometry gates, other-browser checks and wall-clock stability measurements before broader release claims.

## ADSB.fi integration review

A fresh independent reviewer found no critical or important issues. The one minor generated-schema attribution mismatch was corrected using `scripts/export_contract.py`. This is a generated contract update, not a behavior change. Fixtures still pass the deterministic regeneration check. No WorldMonitor code was imported. Live provider results were inspected in memory; no raw aircraft responses or private configuration enter the source ZIP.

TDD evidence: new provider/config tests first failed on the old URL, seconds-based time interpretation, ignored error message and old access gate; attribution tests failed on missing links. The mobile credit regression also failed before the persistent live credit was added. Final totals: 54 backend + 24 frontend + 9 browser checks. Existing Cesium bundle-size warning remains; build succeeds.

The updated source ZIP was extracted to a temporary directory and passed 54 backend tests, 24 frontend tests and a production build using the existing locked dependencies. This was an unpack/build regression check, not a second clean dependency installation. Live polling was disabled in that verification environment; the personal tracker remains running separately. Archive contents and CRC were rechecked after documentation updates.

## Singapore vicinity expansion

The fixed ADSB.fi query and displayed coverage now extend 100 NM (185.2 km) around Changi. A single provider response contained 10 positioned aircraft within the original 25 NM radius and 20 within 100 NM. Live viewer verification after deployment showed 20 tracks, all within the geographic overview, with a healthy feed. No ground aircraft were reported in the comparison response; completeness still depends on source coverage.

The region ring and UI labels match the larger query. Cesium fits the overhead geographic rectangle to the actual screen aspect ratio; close-up runway/follow controls remain available. Independent review caught fixed-height framing clipping edge aircraft on wide/portrait layouts. A failing widescreen regression reproduced two of four edge aircraft in view; geographic fitting passed both wide and portrait edge cases. The related transition check now observes a fresh render after switching modes.

Expansion verification: 54 backend tests, 24 frontend tests, 11 browser tests, typecheck and production build pass. No unresolved review findings. The existing Cesium bundle-size advisory remains. Updated source archive contents and CRC verified.


## OpenSky ground integration — 20 November 2026

The optional OpenSky airport ground source is integrated with private OAuth, independent scheduling/backoff, strict ground/category/timestamp filtering, source-specific status and ICAO deduplication. Cesium remains the map renderer. A fresh review identified source-coupling, malformed-input isolation, invalid counters, category filtering and status provenance issues; all were corrected with failing-then-passing regressions. Cache-only cycles no longer advance the public last-success time.

Final verification: **85 backend tests, 27 frontend tests and 12 browser tests passed (124 total)**. Typecheck and production build passed. Browser coverage includes a synthetic OpenSky ground aircraft selected in Cesium 3D, the Ground/Airborne filters, source credits, mobile credit visibility, and existing scene/fallback/demo behavior. No new dependencies. The existing Cesium bundle-size advisory remains.

Local backend restarted with the supplement gated off. Both direct and preview-proxied API checks reported ADSB.fi healthy with 15 real tracks and no ground reports at that moment; OpenSky reported `permission_required`, disabled, with zero requests. These counts are a point-in-time check, not a coverage guarantee. Automated tests used synthetic records; no real flight responses or credentials are packaged. Continuous OpenSky activation awaits provider use-permission clarification.

The source archive was refreshed and checked for contents, CRC and exclusion of local credential values. The existing feature branch is retained locally; no push, merge or hosted deployment was performed.


## FlyItalyADSB activation — 20 November 2026

The free FlyItalyADSB source is enabled locally alongside ADSB.fi, checking the same 100 NM area every 30 seconds. An independent read-only review found no blocking issues. Verification passed: **89 backend tests, 28 frontend tests, 13 browser tests (130 total)**, typecheck, production build and whitespace checks. The browser suite checks synthetic FlyItalyADSB ground aircraft selection in Cesium 3D, filter behavior, source attribution and mobile footer fit. The existing Cesium bundle-size advisory remains.

At 19:56 SGT, both direct and preview-proxied snapshots were healthy with **24 distinct aircraft**, of which 18 latest positions came from ADSB.fi and six from FlyItalyADSB. No ground aircraft were reported in that snapshot. Winning source counts are not incremental coverage counts. OpenSky remained disabled with zero requests. Both active sources had successful responses. No parked positions are invented.

The key is stored only in ignored, access-restricted backend configuration. The frontend bundle and source files were checked for private credential values. The source archive was rebuilt with content/CRC and credential-exclusion checks. No provider aircraft responses were saved or packaged. No dependencies, push or deployment were added; the local branch and Cesium view are retained.


## GitHub publication — 20 November 2026

Repository: https://github.com/Perryong/sg-real-time-flights

Pages: https://perryong.github.io/sg-real-time-flights/

Provider integration was committed as `97e55e9`; Pages support was committed as `92d09d8`. Both were pushed to remote `main`. GitHub Actions run https://github.com/Perryong/sg-real-time-flights/actions/runs/44738555902 succeeded. Public browser verification showed 16 labelled synthetic aircraft, the Cesium map and the 3D view. The Pages edition has no hosted live backend and disables Live; the existing local tracker remains live. Secrets were checked against current source, all Git-history blobs and the Pages bundle before publication.

Verification: 89 backend + 32 frontend + 13 local browser + 1 Pages browser tests passed (135 total); both production builds passed. Independent review corrected an unused workflow permission-dependent step and outdated README deployment wording. Existing Cesium bundle and GitHub action Node-version advisories do not prevent deployment.


## MacBook live hosting — 20 November 2026

The owner requested the MacBook as backend and GitHub Pages as frontend. The local Python server and Cloudflare Quick Tunnel now run as user login services. GitHub Pages origin is allowed; provider credentials remain only in ignored local configuration. The public tunnel URL is configured as the repository Actions variable `LIVE_BACKEND_URL`. Tailscale Funnel requires account-owner activation and was not enabled.

Deployment https://github.com/Perryong/sg-real-time-flights/actions/runs/44739688580 succeeded. Public HTTPS health and WebSocket checks passed with the GitHub Pages origin. Browser verification at approximately 20:57 SGT showed LIVE FEED, HEALTHY, connected transport, 32 tracked aircraft and the Cesium 3D geographic view. Counts are point-in-time observations, not complete airport inventory; zero ground tracks were reported. ADSB.fi and FlyItalyADSB are active; OpenSky remains gated off.

The Mac must remain awake, signed in and online. The Quick Tunnel hostname changes when its process restarts, requiring a repository variable update and Pages redeployment. README documents the services, logs and stop/restart instructions.


## Daily detected Changi movements — 20 November 2026

Added persistent daily landing/takeoff estimates to the live Traffic panel, using Singapore calendar dates. Conservative repeated runway air/ground transitions are deduplicated in private local SQLite storage, with seven-day retention. Monitoring coverage excludes failed polls, sampling gaps and process downtime. Demo remains isolated, outages retain labelled estimates, and unavailable storage never displays misleading zero totals. Counts start with this collector update and are not retroactive or official airport totals.

Verification: 113 backend tests, 36 frontend tests, 14 browser checks and one Pages browser check passed (164 total); both production builds and whitespace checks passed. Independent review found and verified fixes for a clipped short-phone list and short retry outages incorrectly included in observed time. The phone regression first failed at 375×667, then passed with whole-panel scrolling. Source/build credential scans passed; local runtime storage is excluded from Git and source packaging. Existing Cesium bundle-size and test-runner color advisories remain.

The Mac backend was restarted without changing the public tunnel. Local and public status checks returned healthy feeds and available movement summaries. Initial counts were zero detected events; this does not assert that no flights occurred. Real event-detection accuracy still depends on source coverage and provisional runway geometry; automated event scenarios are synthetic.

Publication completed: commit `a633eb5`, successful Pages deployment https://github.com/Perryong/sg-real-time-flights/actions/runs/44747674832. Public browser verification at 21:50 SGT showed healthy connected live traffic, 31 tracked aircraft, Cesium 3D and the new daily estimates. Monitoring began at 21:47 SGT; both detected movement totals were zero at verification, with partial monitoring coverage visibly explained. The source archive was refreshed and verified without credentials or the private runtime database.


## Historical route context and 500 km view — 20 November 2026

FlyItalyADSB now supplies the 500 km regional query with historical route metadata through the existing 30-second poll. ADSB.fi remains the inner 100 NM source. Metadata is validated separately and merged only across matching ICAO identities and callsigns, preserving source attribution. Equal-position route updates do not renew positions/history; callsign mismatches invalidate prior route evidence. The Traffic panel filters likely inbound/outbound or unknown/other flights; rows and selected details explain historical routes and provide official Changi arrivals/departures links. Fresh airborne movement and compatible course are required for direction labels. The existing Cesium view, phase estimates and separate movement counters remain.

Verification: **129 backend + 42 frontend + 15 browser + 1 Pages browser checks passed (187 total)**. Both production builds and whitespace checks passed. Source/build credential scans passed. Independent review found one equal-position callsign-change issue; a failing regression reproduced it and the fix was verified. Desktop/phone browser checks cover the 500 km boundary, route filters/details, official links, demo isolation and Cesium 3D. Existing Cesium bundle-size and runner colour warnings remain.

After restarting only the Mac backend, a live snapshot was healthy with 44 tracks, 17 historical routes, four routes ending at Changi and three starting there. These are historical route matches, not confirmed current itineraries or the final direction labels. Both active sources were healthy; OpenSky stayed disabled. No raw live responses or credentials were saved to the repository.

Published commit `64091b5`; Pages deployment https://github.com/Perryong/sg-real-time-flights/actions/runs/44752262421 succeeded. At 22:20 SGT the public page showed a healthy live connection, 50 tracked aircraft and the 500 km extent. The inbound filter showed matching flights; selected SIA895 displayed historical HKG → SIN evidence and the unconfirmed-destination explanation in Cesium 3D. Official Changi board links were present. Counts and labels change with new observations; this is a point-in-time smoke check.

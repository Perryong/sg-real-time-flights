# Release evidence — 19 November 2026

This is a runnable local geographic tracker preview. Live observations and authoritative geometry accuracy are not certified. No public deployment was made. The initial preview used no external aircraft queries; a subsequent provider-access check is recorded in provider-contract.md (one refused Airplanes.live request and one successful ADSB.fi evaluation query). Continuous live polling is still disabled pending provider selection.

## Current verification

- Python unit/integration suite: 45 passing.
- Frontend unit/component suite: 21 passing; typecheck and production build pass.
- Chromium browser suite: 8 passing after review fixes (46.3 seconds).
- Five-minute shared-service test: 100 synthetic aircraft, ten ASGI clients, 60 shared polls; p95 receipt-to-client 0.366 s. This measures an in-process ASGI transport, not deployed network latency.
- Two-hour scenario-time backend soak accelerated into 40.34 seconds: bounded identities/history, final-hour memory ratio 1.0634. This is not a two-hour wall-clock or browser soak.
- Five-minute production scene test: **59.47 rendered FPS**, p95 frame interval 18.4 ms, 17,848 actual Cesium frames, 100 entities / 100 aircraft within the geographic view at 1920×1080. Installed Chrome 157.0.8103.79 used ANGLE Metal on Apple M5 Pro (24 GB RAM). Five-minute histories were stored, with the selected aircraft's trail displayed. No page errors; retained JS heap after forced GC was 54.3 MB. This meets the 30-FPS target on this configuration, not on all devices. Routine verification and the backend benchmark ran concurrently for part of the measurement.
- The earlier SwiftShader/development result used browser RAF rather than scene frames and is retained only as a superseded diagnostic (`browser-performance-development.json`). It is not accepted scene-performance evidence. The corrected benchmark rejects induced context loss with `valid=false` and exit code 1 (`benchmark-context-loss.json`).
- Safari 26.5.2 is installed, but WebDriver rejects sessions because remote automation is disabled. No settings were changed. Safari smoke is unverified. Microsoft Edge is not installed. Installed Chrome 157.0.8103.79 passed the visual smoke on Apple M5 Pro / ANGLE Metal; cold local scene 1.253 s, warm 0.433 s. See `browser-smoke.json` and `visual.md`.

## Acceptance gates

| Gate | Status | Evidence / limit |
| --- | --- | --- |
| AC-01 reproducible install/build | Pass on macOS arm64 | Separate clean environment installed lockfiles, 45 backend + 21 frontend tests, production build; `clean-install.json` |
| AC-02 authorized live feed | Unmet | `provider-contract.md`; access, units, terms and Singapore coverage unverified |
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
| AC-14 secrets/attribution/origins | Pass within local release scope | Archive allowlist/CRC and private-key-pattern scan; no .env/dependency cache; backend-only token, origin and escaping tests; licenses included |
| AC-15 source archive | Pass | Clean unpack/install/build/API/browser flow, root goal.md present; temporary services stopped |

## Scope decisions

- Started an isolated feature branch in the empty project, rather than a second worktree; no existing work was displaced.
- A verified-access flag and explicit timestamp units represent the single provider contract. The operator must verify both before enabling polling; this does not establish provider authorization by itself.
- CAAS redistribution permission is unresolved. Distributed geometry comes from OSM and OurAirports with their licenses; authoritative precision remains unmet, and inference remains provisional.
- Community import consistency is tested to its own precision. The authoritative 2 m / 5 m / 0.1° targets are not waived or silently loosened.
- Demo history is 60 seconds to limit fixture size; live history remains 300 seconds. Demo trails are shorter.
- Ports 8017/5177/4177 avoid unrelated services on 8000/5173.
- Scene and interface were integrated together because camera/selection and fallback verification require the complete UI. Their browser checks remain separate.
- Clean npm installation runs inside frontend: npm 11.20 with --prefix through the macOS /var symlink gave a false lockfile mismatch; no dependencies changed.
- No merge/push/deployment is needed for this newly initialized local repository; retain `feat/changi-tracker` and the source archive.

## Review and clean installation

Independent review found six important issues; all were fixed with failing-then-passing regressions. Three minor issues remain explicitly deferred in [review.md](review.md). The final suite is 45 Python tests, 21 frontend tests and 8 browser tests. Typecheck and production build pass.

The source archive was extracted to a separate temporary directory. Python dependencies were installed into a new virtual environment and npm ci succeeded from the frontend directory. The extracted application passed its tests/build, all four API checks, explicit demo selection, pause and mode-isolation checks with map imagery blocked. Temporary ports 8027/4187 and corresponding temporary proxy/origin settings avoided the running app. No dependency versions were changed. After final evidence-only updates, packaging rechecks the archive contents and CRC.

## Remaining validation

The preview must not be described as a verified realtime feed, authoritative airport digital twin, universally performant application, or a two-hour stability-certified release. The 30-FPS result applies only to the measured Chrome/M5 Pro configuration. Complete provider/geometry gates, other-browser checks and wall-clock stability measurements before broader release claims.

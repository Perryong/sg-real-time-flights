# Changi Geographic Flight Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable geographic Changi flight tracker with an overhead/3D map, sourced airport geometry, honest live-data status, aircraft inspection/follow, and explicitly selected offline playback.

**Architecture:** React controls surround a single Cesium renderer. A single-worker FastAPI service validates Airplanes.live observations, bounds history, infers phases and broadcasts full snapshots. Local playback consumes generated fixture frames in a separate frontend adapter and cannot modify the live service.

**Tech Stack:** React, TypeScript, Vite, CesiumJS; Python, FastAPI, Pydantic, HTTPX, Uvicorn; pytest, Vitest, Testing Library and Playwright. No Three.js, database or paid infrastructure required.

**Spec:** `docs/superpowers/specs/2026-11-19-changi-tracker-design.md` (approved), with acceptance requirements in `goal.md`.

## Global Constraints

- “Use one frontend and one single-worker FastAPI service, with a shared lifecycle-managed poller.”
- “Live is the initial application mode.” “Failure never activates demo automatically.”
- “Airplanes.live remains the sole proposed live aircraft source.”
- “The initial implementation must not depend on paid imagery, paid terrain, a Google Maps key, or a Cesium ion token.”
- “10-second display buffer; interpolation only across valid brackets at most 20 seconds apart; extrapolation off by default; optional prediction limited to five seconds and freshness eligibility.”
- “Freshness at position ages 20/21/60/61/120/121 seconds is fresh/delayed/delayed/stale/stale/lost.”
- “Unknown fields remain explicitly unknown.” “Heartbeats and cached responses never renew positions.”
- “Per-frame motion stays outside React rendering.” “Night mode changes presentation only.”
- Default store limits: 300 seconds of history and 1,000 identities. Trend evidence: at least three distinct samples spanning ten seconds, two consecutive qualifying evaluations, reset across gaps over 20 seconds.
- Every source/asset needs provenance and established reuse permission before redistribution. No live release claim until provider, geometry, data integrity and end-to-end gates have evidence.
- Development may continue with synthetic fixtures when external evidence is unavailable. Report unmet requirements explicitly; do not reduce scope silently or invent airport geometry.
- Do not commit chat attachments, credentials, live recordings, caches or dependency installations. Initial repository setup happens only at execution. Detect existing Git/worktree state again before creating anything.

## Review Focus

1. A laptop resumes with an old open socket: recalculate wall-clock age immediately, ignore obsolete callbacks and obtain a current full snapshot (Tasks 5, 7).
2. Provider timestamps are absent, future-dated or duplicated: none may create a fresh position, new trend evidence or false landing (Tasks 1, 2, 4).
3. A slow browser or ten simultaneous viewers: queues stay bounded and upstream polling remains one shared loop (Tasks 2, 8).
4. A map tile, aircraft mesh or WebGL context fails: readable traffic/status remains usable, local geometry survives where WebGL permits, and no stale follow target remains (Tasks 6, 7).
5. Switching/pausing/seeking playback while reconnect callbacks are pending: namespaces, history, inference and clocks remain isolated without future-sample leakage (Tasks 4, 5, 7).

## Files and shared interfaces

All paths below are repository-relative. Commands run at the repository root unless marked otherwise.

| Area | Files and responsibility |
|---|---|
| Reproducible setup | `.gitignore`, `.env.example`, `README.md`, `frontend/package.json`, `frontend/package-lock.json`, `backend/pyproject.toml`, `backend/requirements.lock`, runtime-version files |
| Contract/config | `backend/app/contracts.py`, `backend/app/config.py`, `frontend/src/data/types.ts`, `scripts/export_contract.py`, `data/contracts/snapshot.schema.json` |
| Provider/store | `backend/app/provider.py`, `backend/app/normalize.py`, `backend/app/store.py`, `backend/app/clock.py`, `backend/app/service.py` |
| API | `backend/app/main.py`, `backend/app/api.py`, `backend/app/stream.py` |
| Geometry | `data/airport/manifest.json`, `runways.geojson`, `taxiways.geojson`, `buildings.geojson`, `scripts/import_airport.py`, `scripts/verify_airport.py` |
| Inference/playback | `backend/app/inference.py`, `backend/app/runway_math.py`, `scripts/build_fixtures.py`, `tests/fixtures/scenarios/*.json`, `frontend/src/data/playback.ts` |
| Client data | `frontend/src/data/live.ts`, `stream.ts`, `freshness.ts`, `display.ts`, `frontend/src/hooks/useTraffic.ts` |
| Cesium scene | `frontend/src/scene/MapScene.tsx`, `airport.ts`, `aircraft.ts`, `camera.ts`, `imagery.ts`, `frontend/public/models/generic-aircraft.glb` |
| Interface | `frontend/src/App.tsx`, `styles.css`, `components/Search.tsx`, `TrafficList.tsx`, `AircraftDetails.tsx`, `MapControls.tsx`, `FeedStatus.tsx`, `ModeControls.tsx`, `SourceDetails.tsx` |
| Verification/release | `backend/tests/`, `frontend/src/**/*.test.ts*`, `frontend/e2e/`, `scripts/benchmark.py`, `scripts/soak.py`, `scripts/package.py`, `docs/evidence/`, `assets/LICENSES.md` |

Contract decisions (schema version `1`; JSON field names use snake_case on both sides):

- `Mode = "live" | "simulated" | "recorded"`. Serialize event times as UTC epoch seconds, including fractions; never mix milliseconds into the wire contract.
- `Observation`: `id`, `provider`, `provider_id`, `session_id`, `callsign`, `registration`, `aircraft_type`, `mode`, `lat`, `lon`, nullable `alt_geom_m`, `alt_baro_m`, `ground`, `speed_mps`, `track_deg`, `heading_deg`, `vertical_rate_mps`; nullable `position_time`, `provider_time`, `message_time`; required `receipt_time`; `timestamp_quality`, `source_category`, `quality`, `raw`. `raw` preserves original altitude/motion values and units, and available per-field timing.
- `PhaseEstimate`: `phase`, `candidate_runways: string[]`, `confidence: "low" | "medium" | "high"`, `reasons: string[]`, `evidence_times: number[]`, `rule_version`. Unknown is an explicit phase, never a confident placeholder.
- `Track`: `id`, `session_id`, `latest: Observation`, `history: Observation[]`, `phase: PhaseEstimate`. Histories contain accepted observations only, with explicit breaks/session changes.
- `FeedStatus`: `mode`, `upstream_state`, `error_code`, `message`, nullable `last_attempt`, `last_success`, `next_retry`, `newest_position_time`; geometry edition and timing/invalid/eviction/dropped-update counters. Transport state belongs to each browser and is separate.
- `Snapshot`: `type: "snapshot"`, `schema_version`, `epoch`, `sequence`, `mode`, `server_time`, nullable `scenario_time`, `status`, `tracks: Track[]`. Heartbeat messages contain epoch/sequence/server time/status but cannot replace observations or increment their timestamps.
- `AirportManifest`: source metadata, CRS, vertical-reference policy, geometry file references/checksums, verification state, operational-status caveat and named camera presets. Versioned GeoJSON coordinates use `[longitude, latitude]`.
- `DisplayPosition`: position, `method: "observed" | "interpolated" | "predicted" | "last_known" | "unavailable"`, render time, source/bracket times and prediction duration. Origin `Mode` remains independent of display method.
- Playback fixtures are generated finite `Snapshot[]` plus an explicit epoch, sample interval, provenance and scenario description. Runtime seeking replays preceding frames; no browser flight-inference reimplementation.

## Task 1: Baseline, typed contract and time validation

**Requirements:** M0; FR-03/06/14; NFR-08/09/10; AC-01/04/07.
**Files:** setup and contract/config files above; `backend/tests/test_normalize.py`, `frontend/src/data/freshness.test.ts`, `docs/evidence/baseline.md`.
**Consumes:** approved design and actual local runtime inventory. Planning inspection found Node 26.13.0, npm 11.20.0, Python 3.13.14; these are observed installations, not a verified compatibility matrix.
**Produces:** `normalize_record(raw: dict, provider_time: float | None, receipt_time: float, mode: Mode, contract: ProviderContract) -> Observation | Rejection`; `freshness(positionTime: number | null, now: number): Freshness`; Pydantic/wire schema and matching frontend types.

- [ ] Record the absent v0.1 source and inspect repository guidance/Git state. If still no repository, initialize Git in place, ignore attachments/caches/secrets, and commit approved documentation. No redundant worktree for an empty new project.
- [ ] Verify official current compatibility requirements, choose installed compatible runtimes or a supported available runtime, pin package versions and produce lockfiles. Set up pytest/Vitest/typecheck/build scripts and Cesium asset handling without adding product behavior.
- [ ] Write parameterized tests asserting ages `[20,21,60,61,120,121]` yield `[fresh,delayed,delayed,stale,stale,lost]`, null time yields unknown, future time yields unknown, and zero speed/heading survive normalization. Assert `alt_baro="ground"` produces `ground=true` and `alt_baro_m=null`; null altitude remains null.
- [ ] Write tests rejecting nonfinite/out-of-range coordinates and treating absent/unverified source-time units as unknown. Unit conversion assertions: `1000 ft == 304.8 m`, `60 knots ~= 30.8666667 m/s`, `1000 ft/min == 5.08 m/s`. Require verified contract semantics before calculating position time.
- [ ] Run `.venv/bin/python -m pytest backend/tests/test_normalize.py -q` and `npm --prefix frontend test -- freshness`; confirm meaningful failures before implementing the exported signatures and schema.
- [ ] Implement contract/config/normalization/freshness and export schema; validate a shared snapshot fixture against both backend and frontend validation. Run both tests and `npm --prefix frontend run typecheck`; expect all pass.
- [ ] Commit task files with `feat: define validated aircraft and timing contracts`.

## Task 2: Shared provider ingestion, bounded storage and service API

**Requirements:** M1/M3; FR-02/07/10/11; NFR-02/03/07/12; AC-02/08/14.
**Files:** provider/store/API files above; `backend/tests/test_provider.py`, `test_store.py`, `test_api.py`, `test_stream.py`; `docs/evidence/provider-contract.md`.
**Consumes:** Task 1 contract/config and normalizer.
**Produces:** `AirplanesProvider.fetch() -> ProviderResult`; `TrackStore.ingest(observations: list[Observation], now: float) -> IngestReport`; `TrackStore.snapshot(now: float) -> list[Track]`; `create_app(settings: Settings, provider: Provider, clock: Clock) -> FastAPI`.

- [ ] Retrieve official API/access/usage documentation and record dated endpoint, units, required attribution, retention, rate limits and evidence links. An HTTP error is evidence of a failed check only. If unresolved, gate live mode as configuration required and keep adapter semantics provisional and tested with synthetic data.
- [ ] Write HTTPX mock tests for timeout, malformed schema, partial invalid records, valid empty results, 401/403, 429 numeric/date `Retry-After`, and 5xx. Assert no successful-response timestamp on invalid payload; access errors stop automatic polling; 429 never retries early; five-second timeout; no overlapping requests.
- [ ] Write store tests: cached and duplicate samples never advance current position/evidence; out-of-order samples never rewind state; an implausible jump starts a discontinuity; 300-second history and 1,000 identities remain bounded; eviction is counted; lost tracks expire without fabricating departure events.
- [ ] Write API/stream tests for all four GET endpoints and `/ws/aircraft`: process health independent of feed health, full snapshot on connect, monotonically increasing sequence within one epoch, new epoch on restart, ten-second heartbeat, one latest pending snapshot per slow client, and restricted HTTP/WebSocket origins. Assert ten clients cause no additional upstream fetches.
- [ ] Run `.venv/bin/python -m pytest backend/tests/test_provider.py backend/tests/test_store.py backend/tests/test_api.py backend/tests/test_stream.py -q`; confirm failures.
- [ ] Implement lifecycle startup/shutdown, fixed host, shared HTTP client, default ten-second policy-compliant poll interval, exponential jittered backoff capped at 60 seconds, counters and structured logs without credentials. Evaluate status against clock time: successful poll within 30 seconds/no current failure healthy; errors or >30 seconds degraded; no success or >60 seconds unavailable.
- [ ] Rerun tests; run a permitted live smoke check only if access/contract verification succeeded. Save a redacted comparison of source vs normalized fields, not an unapproved live archive. Mark live verification unmet otherwise.
- [ ] Commit with `feat: stream bounded aircraft snapshots from a shared feed`.

## Task 3: Sourced airport geometry and redistributable visual assets

**Requirements:** M2; FR-01/04/13; NFR-10; AC-03/12/14.
**Files:** geometry and asset files above; `backend/tests/test_airport.py`, `tests/fixtures/airport/threshold_reference.json`, `docs/evidence/geometry.md`, `assets/LICENSES.md`.
**Consumes:** Task 1 `AirportManifest`; effective CAAS WSSS and permitted supplemental sources.
**Produces:** `load_airport() -> AirportManifest`; validated GeoJSON with IDs for 02L/20R, 02C/20C and 02R/20L, sourced taxiways/buildings, metadata and model license.

- [ ] Select and record the effective CAAS edition; distinguish planned layers and unknown operational availability. Independently transcribe published threshold coordinates into the test reference with source precision. Verify reuse terms for factual extraction and each supplemental dataset before including derived data.
- [ ] Write tests asserting every runway pair is represented, coordinates are WGS84 longitude/latitude, each layer has source dates/reference/reuse status/checksum, and unknown operational status is preserved. Against the independent reference, assert threshold differences <=2 m, length differences <=5 m, bearing differences <=0.1 degrees, or require an explicit documented source-precision exception.
- [ ] Run `.venv/bin/python -m pytest backend/tests/test_airport.py -q`; confirm missing/invalid geometry fails.
- [ ] Implement import and verification scripts using geodesic calculations; preserve thresholds separately from pavement ends. Import licensed taxiway/building footprints, mark estimated heights, and document altitude conversion/fallback. If sourcing is blocked, leave corresponding completeness gates unmet instead of manufacturing coordinates.
- [ ] Create an original generic aircraft GLB with a license entry and orientation/scale metadata; build the marker fallback. Document decorative lighting separately from sourced infrastructure.
- [ ] Run `.venv/bin/python scripts/verify_airport.py` and geometry tests; inspect every runway end and terminal placement in the Task 6 viewer before accepting visual geometry completion.
- [ ] Commit with `feat: add versioned Changi geometry and generic aircraft assets`.

## Task 4: Explainable phase inference and deterministic scenarios

**Requirements:** M4; FR-08/12; AC-09/11; goal sections 9 and 10.
**Files:** inference/playback generation files above; `backend/tests/test_inference.py`, `test_scenarios.py`, `docs/evidence/inference.md`.
**Consumes:** accepted Task 2 tracks, Task 3 sourced runway geometry, injected `Clock.now() -> float`.
**Produces:** `infer_phase(history: list[Observation], runways: list[Runway], now: float, previous: PhaseEstimate, config: InferenceConfig) -> PhaseEstimate`; finite generated fixture streams, served read-only at `/api/fixtures/{name}` from a fixed manifest (no arbitrary path access).

- [ ] Write scenarios for both runway directions, full arrival/departure, missing touchdown coverage, first detection airborne, go-around, overflight, parallel-runway ambiguity, taxi near runway, gaps/jumps, contradictory/missing ground flags, unknown altitude datum, low-speed heading noise, stale/late/duplicate samples and identity/callsign changes.
- [ ] Assert three distinct samples over >=10 seconds and two qualifying evaluations are necessary for trend transitions; a 21-second gap resets evidence. Assert no-coverage approaches never imply landing; no ground flag never implies taxi from altitude alone; ambiguous corridors do not select one runway confidently; stale/unknown timing suspends transitions.
- [ ] Assert final-approach candidates use the configured 8 NM upstream/300 m cross-track/15-degree course corridor with credible descent/low-altitude evidence. Landing/takeoff candidates require continuous ground-transition/speed evidence; go-around requires prior approach and sustained climb, not missing samples.
- [ ] Run `.venv/bin/python -m pytest backend/tests/test_inference.py backend/tests/test_scenarios.py -q`; confirm failures.
- [ ] Implement deterministic inference with explicit reasons/evidence/rule version, bounded state and multiple candidate runways. Generate simulated frames via the same normalizer/store/inference pipeline and injected historical scenario clock, retaining a distinct namespace.
- [ ] Add fixture generation tests proving pause preserves scenario age, restart clears history, and seek rebuilds only preceding observations. Include permitted synthetic recorded-contract fixtures labeled as synthetic test material, not real historical flights.
- [ ] Run tests and `.venv/bin/python scripts/build_fixtures.py --check`; record scenario outcomes. Real-world confusion matrix remains unverified until permitted independently reviewed tracks exist.
- [ ] Commit with `feat: infer flight phases from explicit observation evidence`.

## Task 5: Client stream consistency, clocks and display positions

**Requirements:** M3; FR-07/10/11/12; AC-05/06/07/11.
**Files:** client data/hooks above; corresponding `stream.test.ts`, `display.test.ts`, `playback.test.ts`.
**Consumes:** Task 1 contract and Task 2 full snapshots/heartbeats; Task 4 fixture streams.
**Produces:** `acceptSnapshot(state: StreamState, incoming: Snapshot, connectionId: number): StreamState`; `displayPosition(track: Track, renderTime: number, now: number, predictionSeconds = 0): DisplayPosition`; `PlaybackController` with `play()`, `pause()`, `seek(time: number)`, `dispose()`; `useTraffic()` returns current mode/status/tracks, selection and playback controls.

- [ ] Write fake-clock tests: observations t=0 and t=10 interpolate at display t=5; a 21-second bracket does not interpolate; default prediction is off; opt-in prediction stops at five seconds and returns to last observation; no generated display position enters inference/history.
- [ ] Write stream tests for old sequence, restart epoch, delayed callbacks from a superseded socket, malformed messages, heartbeat time advancement without position renewal, browser resume and 30-second transport silence. Test bounded jittered reconnect at 1–30 seconds and full resynchronization.
- [ ] Write playback tests asserting original timestamps survive, age follows scenario time, pause freezes motion/expiry, seek never includes future observations, entering demo detaches live callbacks, and returning live clears demo identities before accepting a fresh snapshot. Validate fixture payloads just like live payloads.
- [ ] Run `npm --prefix frontend test -- stream display playback`; confirm failures.
- [ ] Implement adapters and pure display math with explicit timestamp quality, server clock-offset estimation and future-time rejection. Interpolate in a suitable Cartesian/geographic representation rather than naive longitude interpolation across wraps. Detach timers/listeners on disposal; recalculate freshness from clocks rather than message arrival.
- [ ] Rerun tests and `npm --prefix frontend run typecheck`; expect pass. Commit with `feat: isolate live and playback clocks with bounded display interpolation`.

## Task 6: Geographic Cesium viewer and airport views

**Requirements:** M2/M3/M4; FR-01/04/05/07/09; AC-10/12.
**Files:** scene modules, Cesium Vite/static asset configuration, `frontend/e2e/scene.spec.ts`, `docs/evidence/visual.md`.
**Consumes:** Task 3 manifest/GeoJSON/assets; Task 5 tracks/display policy. Scene receives callbacks for selection and visible-track count.
**Produces:** `MapScene` component with `tracks`, `selection`, `mode`, `night`, `view`, `layers`, `onSelect`, `onVisibleCount`, `onError` props; camera controller methods `overview()`, `runway(id)`, `follow(id)`, `stopFollow()`, `setView("overhead" | "3d")`.

- [ ] Implement the full-screen, initially north-up regional view using one Cesium Viewer with locally served Cesium assets and no mandatory cloud token. Verify permitted imagery policy/configuration; expose attribution and a simple-background fallback.
- [ ] Render sourced airport layers, simplified terminal masses, runway labels and disclosed decorative night lighting. Add per-layer controls and source details. Preserve actual timestamps when scene lighting changes.
- [ ] Maintain stable entities keyed by track/session ID; reuse model assets, bound trails, distinguish observation points from display interpolation/prediction and show unknown/stale styling. Use heading-oriented symbols at regional scale and the generic model at close range with marker fallback.
- [ ] Implement overhead/tilted view, north reset, zoom, overview, named runway cameras and follow. Respect reduced-motion preference; stop follow on lost/removed selection or Escape. Clean up viewer/listeners/entities on unmount and mode changes.
- [ ] Run Playwright scene checks with deterministic fixtures: selection/follow/exit, loss, layer toggles, night timestamp invariance, model failure, blocked imagery and unavailable WebGL. Inspect screenshots at 1920×1080 and 390×844, all runway ends and day/night views. Capture actual visual evidence; do not use screenshot-only success for data checks.
- [ ] Run `npm --prefix frontend run test:e2e -- scene.spec.ts`, typecheck and production build; expect passing assertions/build. Commit with `feat: add Changi geographic map and optional 3D views`.

## Task 7: Tracker interface and end-to-end honest states

**Requirements:** M3/M4; FR-05/06/09/10/12/13; NFR-06; AC-04/08/10/11/12.
**Files:** interface components/styles, component tests and `frontend/e2e/tracker.spec.ts`.
**Consumes:** Task 5 traffic hook and Task 6 map; API status/manifest.
**Produces:** runnable tracker with dark floating controls, searchable traffic list, desktop details panel/mobile sheet, source/uncertainty inspection and explicit demo choice.

- [ ] Write component tests asserting null measurements show “Unknown,” ground does not show invented 0-ft altitude, blank callsign uses identifier, provider text is escaped, source/age/reference/display method are visible, and labels never claim a confirmed landing from an inference candidate.
- [ ] Write end-to-end cases for initial live-unavailable (zero invented aircraft), valid empty feed, degraded upstream with connected socket, stale disconnection, explicit demo and return to live, keyboard search/selection/follow exit, and readable list without WebGL. Check in-view vs tracked counts and selected-track loss notice.
- [ ] Run `npm --prefix frontend test` and `npm --prefix frontend run test:e2e -- tracker.spec.ts`; confirm meaningful failures for the missing controls/states.
- [ ] Implement top search/mode/status, responsive traffic/details, map controls, provenance/layer panel and persistent “SIMULATED”/“RECORDED — NOT LIVE” banner. Display actual buffer/render time and separate transport/upstream health. Include “Not for navigation or operational decisions.”
- [ ] Add explicit local fixture selection with pause/restart/seek for testing, using Task 5 playback. Do not expose a public historical service or change global backend mode from the browser.
- [ ] Rerun component/E2E tests, inspect keyboard focus, readable contrast, reduced motion, loading/error and mobile layouts. Verify no controls are decorative or claim features without behavior.
- [ ] Commit with `feat: complete the geographic flight tracker interface`.

## Task 8: Release validation, documentation and distributable source

**Requirements:** M5; FR-14; NFR-01–12; AC-01–15.
**Files:** README/config/license docs, benchmark/soak/package scripts, `docs/evidence/release.md`, `docs/evidence/acceptance.md`, `dist/changi-tracker-source.zip`.
**Consumes:** all prior tasks and their evidence; no test substitutes for unavailable live authorization.
**Produces:** runnable documented source, verified clean archive and an acceptance table separating pass/fail/blocked/not-run.

- [ ] Document exact runtime/dependency versions, commands, frontend/backend ports, single-worker requirement, environment options, live access gate, imagery configuration, modes/clocks, attribution, altitude approximations, uncertainty, troubleshooting and measured limitations. Keep optional tokens out of source and browser secrets impossible by configuration.
- [ ] Run `.venv/bin/python -m pytest backend/tests -q`, `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and `npm --prefix frontend run test:e2e`. Resolve failures by reproducing their cause; store concise outputs/runtime details.
- [ ] Benchmark 100 visible aircraft with five-minute trails at 1920×1080 over five minutes after warm-up, recording hardware/browser/assets and FPS target >=30. Measure p95 backend-receipt-to-client-receipt <=2 seconds separately from provider age and display buffer. Check warm-cache usability within ten seconds; report cold cache separately.
- [ ] Test ten concurrent clients with an injected/mock provider; assert one shared poll schedule and bounded pending updates. Run `.venv/bin/python scripts/benchmark.py --clients 10 --duration 300` and retain timing/poll counters.
- [ ] Run `.venv/bin/python scripts/soak.py --duration 7200` with fixed-size scenarios, outages/reconnects/identity churn; monitor in bounded nonblocking intervals. Verify no crashes/duplicates/unbounded stores and final-hour memory stays within 20% after warm-up. Distinguish backend soak from browser heap stability; exercise both or report the missing measurement.
- [ ] If live authorization is verified, sample three 30-minute windows at different Singapore times including evening; retain permitted aggregate coverage/timing/error evidence. Otherwise mark AC-02 and real coverage/classification unverified. Do not wait for external access by fabricating successful evidence.
- [ ] Run current desktop Chrome and Edge checks and Safari smoke test on installed accessible browsers. A different browser engine is not proof of Safari/Edge compatibility; record unavailable checks accurately.
- [ ] Conduct an independent whole-change review per execution workflow, emphasizing time honesty, geometry/altitude, mode isolation, resource bounds and security. Fix actionable findings and rerun affected checks before claiming success.
- [ ] Implement packaging with an explicit allowed-file set, excluding `.env`, `.venv`, `node_modules`, `.git`, `.codex-attachments`, unapproved live data and prior archives. Run `.venv/bin/python scripts/package.py`; inspect ZIP entries and scan for accidentally bundled credentials.
- [ ] Unpack into a temporary directory, install strictly from lockfiles, build and start both services on unused ports, verify health/airport/status and offline fixture browser flow, then stop temporary services. Include root `goal.md`, README, source, lockfiles, permitted assets/fixtures and configuration example.
- [ ] Complete the acceptance table with actual evidence and external gates. Commit with `docs: package and verify Changi tracker release`; finish within the authorized local scope without public deployment.

## Self-review and execution recommendation

- The file map and contract definitions cover all planned interfaces; tasks consume the exact exported names above.
- Tasks map all FR-01–14 and AC-01–15; geometry/live-access/performance requirements remain requirements even when blocked or unmeasured.
- All five Review Focus cases have explicit tests in their owning tasks. Risky data logic uses failing tests before implementation; visual styling uses browser verification.
- The work is one integrated application; Task 1–2 establish the data boundary, Task 3 supplies geographic facts, Task 4 produces inference/fixtures, Tasks 5–7 join them, Task 8 verifies the release.
- Recommended execution: **Native** in this chat, followed by an independent whole-change review. The small new repository has tightly shared schema/clock/geometry interfaces, so one implementer can keep those consistent without repeated task handoffs. Subagent-driven execution remains available if the user prefers per-task independent reviews.
- Planning is complete. Product code has not been scaffolded, dependencies have not been installed, and live polling has not been enabled. The writing-plans workflow requires user plan review and execution-method selection before implementation.

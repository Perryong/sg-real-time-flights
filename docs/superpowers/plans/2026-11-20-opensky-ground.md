# OpenSky Ground Supplement Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The user explicitly requested proceeding with the integration; implement in the existing tracker checkout.

**Goal:** Add real OpenSky ground reports at Changi alongside ADSB.fi without changing the Cesium 3D view.

**Architecture:** A shared backend collector schedules ADSB.fi and an optional OpenSky ground adapter independently. OpenSky exchanges private OAuth credentials for memory-only tokens, polls the airport box at least 30 seconds apart, and filters stale/invalid reports and identified vehicles. Deduplicate valid ICAO addresses using the newest position, retaining observation provenance. Expose each provider's state separately; one failure must not stop the other.

**Tech Stack:** Existing Python/FastAPI/httpx, React/TypeScript and Cesium; no new dependencies.

**Spec:** The user's current integration request and the account/access setup in this conversation. Scope choices below are implementation decisions, not claims of OpenSky permission.

## Global Constraints
- Keep ADSB.fi and Cesium; private credentials never enter frontend, fixtures, logs or archives.
- OpenSky defaults off. Enable only with credentials, OPENSKY_ENABLED=true and OPENSKY_USE_CONFIRMED=true after provider permission is clarified. Keep the user's current OpenSky polling off.
- Box: latitude 1.30–1.40, longitude 103.965–104.03. Ground status must be true, position time known and at most 120 seconds old. Require an aircraft emitter category; omit no-information, reserved, parachutist, vehicle and obstacle categories. Unknown aircraft model/type stays unknown.
- Report original position time separately from message and receipt time. Never invent parked positions or confirmed landing events.
- Respect independent backoff, token expiry, access denial and daily credit exhaustion. Preserve all existing demo behavior.

## Review Focus
- OAuth failure or quota exhaustion must not interrupt ADSB.fi or leak credentials.
- Cached ground observations must not acquire new timestamps or override a newer airborne report.
- Unknown/invalid category, coordinates and timestamps must not become fresh aircraft.
- Stable deduplication must avoid duplicate map entities and interpolation across provider changes.
- Disabled OpenSky must be visible as disabled, never described as active or secretly polled.

### Task 1: Backend ground supplement
**Files:** new backend/app/opensky.py and backend/app/combined.py; config.py, contracts.py, main.py, service.py, store.py; tests/test_opensky.py, tests/test_combined.py, tests/test_config.py.
**Interfaces:** OpenSkyGroundProvider.fetch() returns ProviderResult. CombinedProvider.fetch() returns the freshest deduplicated observations; statuses() supplies public per-source health without credentials.
- [x] Write failing adapter/config/merge/scheduling tests; run and confirm feature failures.
- [x] Implement OAuth, bounded responses, ground parsing, independent collection and safe configuration.
- [x] Run full backend suite and inspect failures.

### Task 2: UI, verification and delivery
**Files:** frontend source labels and status types; source attribution tests; browser regression; .env.example, README.md and evidence notes.
**Interfaces:** FeedStatus.sources is additive and optional for older/synthetic snapshots; display actual provider for each selected observation and source health in Sources & accuracy.
- [x] Write failing source-status and ground-view regressions; implement the UI.
- [x] Run frontend unit tests, typecheck/build and browser tests using synthetic provider responses.
- [x] Review the full change with a fresh reviewer; fix important findings with regressions.
- [x] Restart local backend with OpenSky still disabled, verify the running tracker, and refresh the source archive without secrets.

## Progress / decisions
- Working in place preserves the current local preview, dependencies and private configuration; no new worktree or copied secrets.
- Continuous OpenSky use remains disabled pending clarification from OpenSky; automated integration tests use synthetic HTTP responses.

- Final review: fresh reviewer found delayed primary publication, uncontained malformed input, hidden primary source health, lost invalid-record counters and unclassified ground contacts counted as aircraft.
- Final: fixed slow-source publication — test_slow_ground_source_does_not_delay_primary_publication RED→GREEN; collector now wakes on either source completion or the other source’s deadline. Ten-second total source timeout; shutdown cancels pending requests.
- Final: fixed malformed-source isolation — test_unexpected_ground_error_is_contained_and_primary_keeps_polling RED→GREEN; sanitized per-source failures, cancellation propagates.
- Final: fixed lost invalid counts — test_invalid_counts_are_reported_once_per_actual_source_response RED→GREEN.
- Final: fixed primary status visibility — paused-source attribution test RED→GREEN, primary status and times use its own source record.
- Final: fixed unclassified ground contacts — category regression RED→GREEN. Require affirmative aircraft emitter classification; legitimate aircraft without category information may be omitted.
- Mobile browser regression caught credits hidden by existing span CSS; corrected selector to retain provider credits. Initial new 3D test incorrectly waited for an uninitialized benchmark hook; corrected it to assert the actual Cesium canvas and view toggle.

- Final: fixed aggregate success time advancing on cached data — cache-only status regression RED→GREEN. Final suite: 85 backend, 27 frontend, 12 browser tests; production build and typecheck pass. Local preview healthy; OpenSky disabled with zero requests. No unresolved review findings.

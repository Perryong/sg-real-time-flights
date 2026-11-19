# Changi geographic flight tracker

Date: 19 November 2026, Asia/Singapore
Status: Approved by the user on 19 November 2026 with “Proceed the next step.” Implementation planning in progress; no application implemented yet.

## Intent and decisions

Build the application described in `goal.md` as a geographic flight tracker focused on Singapore Changi Airport (SIN / WSSS). The user's latest clarification selects a geographic tracker over a cinematic airport experience. Their two screenshot references illustrate a map filling the screen, aircraft icons, compact floating controls, search, and flight details. They are visual references, not evidence of data access or instructions to reproduce another product's branding.

The user has requested actual application development; the older documentation-only deliverable language inside the attached goal does not limit that request. Its product requirements remain the requirements baseline. Workflow statements in that document are reference material; the explicitly invoked Superpowers skill supplies the development workflow.

The working directory was empty apart from chat attachments when inspected. No previous prototype is available here. This is a new implementation, not a verified continuation of v0.1.

## Approaches considered

1. **Cesium geographic viewer — selected direction.** React/TypeScript/Vite controls around one Cesium renderer, with FastAPI handling Airplanes.live and WebSockets. Supports overhead mapping, globe coordinates, terrain/imagery, and geolocated airport/aircraft models in one scene. Best fit for the user's geographic-tracker choice and the master specification.
2. **Three.js airport scene.** Offers extensive custom rendering control but requires additional geographic/terrain integration. Better suited to a cinematic local scene; does not match the selected priority.
3. **Cesium plus Three.js in the same scene.** Adds renderer, camera, depth and coordinate synchronization without a demonstrated missing capability. Deferred. Detailed models can load directly in Cesium.

The proposed visual defaults below are builder recommendations, not previously approved user decisions.

## Experience and visual design

- Open on Singapore and Changi's surrounding approach/departure area in a north-up overhead view. The initial area matches the configured provider query coverage rather than suggesting global traffic coverage.
- Let the map fill the viewport. Use dark navy/charcoal control surfaces, readable neutral text, amber aircraft, and a lime/cyan selected-aircraft accent inspired by the references. Do not copy their brands or proprietary assets.
- Top controls: product name, callsign/identifier search, explicit data-mode indicator, and feed/connection health. No flight schedules, airline routes or destinations invented from callsigns.
- Side controls: zoom, north reset, Changi overview, named runway viewpoints, overhead/3D view, day/night presentation, and layers. Keep controls keyboard accessible with visible focus and descriptive names.
- Show simple heading-oriented aircraft symbols at regional scales. Introduce generic licensed aircraft meshes when zoomed in; retain markers if models fail. Color and text distinguish selection and stale data rather than implying unsupported airline or flight-status information.
- Selecting an aircraft opens a desktop side panel or mobile bottom sheet. Show identity, callsign, source, observed position time, age, original altitude/reference, speed, display method, inferred phase/reasons, and follow/unfollow controls. Unknown fields remain explicitly unknown.
- Show a searchable traffic list that remains usable if WebGL fails. Counts reflect the active mode and freshness policy; distinguish aircraft in view from all currently tracked aircraft.
- A compact persistent status strip shows transport, upstream status, last success, display buffer, and newest position age. A separate persistent non-live banner identifies simulated or recorded mode.
- The 3D control tilts the same geographic scene; preserve selection and data mode. Airport overview and runway camera presets provide close-up views without turning the app into a flight simulator.
- Night mode changes presentation only. It does not alter observation timestamps or claim that airport lighting conditions are observed.
- Keep map attribution visible. Satellite imagery is optional only when a permitted provider/configuration is available. The initial implementation must not depend on paid imagery, paid terrain, a Google Maps key, or a Cesium ion token.
- No user-facing historical replay service, weather feed, lounge guides, account system, or global provider expansion in this release. The replay controls visible in the second reference are not a request for those features. Explicit local fixture playback remains required by the master specification.

## Architecture and contracts

Use one frontend and one single-worker FastAPI service, with a shared lifecycle-managed poller. No database, Redis, account system or distributed ingest for the initial release.

Backend boundaries: provider adapter; validation/normalization; bounded time-ordered track store; pure inference logic; scenario clock; REST/WebSocket delivery. Frontend boundaries: typed transport client; freshness/display-position policy; Cesium scene adapter; accessible React controls/panels. Per-frame motion stays outside React rendering.

Implement the master specification's health, status, aircraft, airport and WebSocket interfaces. Snapshots carry schema version, stream epoch, monotonic sequence, mode, server/scenario time, status and normalized aircraft. New connections obtain a full snapshot. A new epoch clears incompatible state; within an epoch reject out-of-order snapshots. Late messages from a superseded connection cannot restore an old epoch. Client queues and backend track histories are bounded.

Use provider plus provider aircraft identifier for identity, with session handling for discontinuities and explicit namespaces for synthetic/recorded records. Preserve nullable measurements, raw altitude values, source timing quality and provenance. Never substitute receipt time for an unknown observed position time.

## Live data and offline modes

Airplanes.live remains the sole proposed live aircraft source. On this design's research check, the official API documentation returned HTTP 403 to the browsing tool. That does not prove the deployment API is inaccessible or authorized. Endpoint contract, access terms, timing semantics and local coverage remain unverified.

Before enabling live polling, verify access requirements and usage policy from authoritative documentation or authorization. Keep credentials backend-only and upstream host allowlisted. Do not add another aircraft provider without a separate user decision. If terms or permission remain unresolved, implement and test the adapter using synthetic contract fixtures and show live unavailable/configuration required; do not issue unapproved continuous sampling.

Live is the initial application mode. If live access is unavailable, the initial scene still loads airport geometry and clearly explains the unavailable feed; it contains no synthetic aircraft. The user may explicitly choose a labeled demo. Failure never activates demo automatically.

Demo uses deterministic synthetic fixtures and an explicit scenario epoch; recorded mode accepts only permitted local fixtures and retains original timestamps. Mode selection is application-wide for this first single-instance service, not an upstream poller per browser. Expose development configuration for the service mode and reload/resynchronize clients on epoch/mode changes; do not provide an unauthenticated public API that changes the service mode. For convenient UI demo selection, use a separate client-side fixture playback adapter with the same normalized contract and tested inference rules supplied by the backend fixture output, isolated from the live connection/store. Leaving demo obtains a new full live snapshot. Pause freezes scenario time and scenario freshness; live freshness always advances on wall time.

## Position display and inference

Implement the exact defaults and boundary tests in `goal.md`: 10-second display buffer; interpolation only across valid brackets at most 20 seconds apart; extrapolation off by default; optional prediction limited to five seconds and freshness eligibility. Return to the last observation when prediction expires. Break trails across discontinuities.

Freshness at position ages 20/21/60/61/120/121 seconds is fresh/delayed/delayed/stale/stale/lost. Unknown source time means unknown freshness. Heartbeats and cached responses never renew positions. Selected lost tracks retain a notice while follow mode stops.

Backend inference consumes only accepted observations using the appropriate wall/scenario clock. Require multiple distinct samples, continuity, configured trend windows and hysteresis. Phase labels remain estimates with reasons, candidate runway and heuristic confidence. Missing ground coverage cannot establish touchdown, rollout or takeoff. Geometry and altitude uncertainty lower confidence or produce unknown state. Synthetic fixtures establish rule behavior, not real-world accuracy.

## Airport geometry and assets

Use effective CAAS WSSS sources for the three runway pairs, with versioned coordinates, thresholds versus pavement ends, elevation/reference information and source manifests. Supplement taxiways, terminal footprints and local context from appropriately licensed sources such as OpenStreetMap. Extruded terminal masses may have estimated heights, visibly disclosed. Do not redistribute charts or assets without established permission.

Source manifests record publisher, URL, edition/effective/retrieval dates, coordinate reference, extraction method/precision, reuse status and checksums. Verify imports against authoritative coordinates. Physical presence is distinct from current operational availability; do not claim a runway is open based on a static map.

Create or use redistributable generic aircraft models with a license record and marker fallback. Aircraft attitude derived from track is an estimate. Keep raw altitude separate from visual placement; document the vertical-datum approximation and never derive touchdown from model-ground contact.

Use permitted map tiles with visible attribution, respect provider policies and avoid bulk downloads. Maintain an ellipsoid/simple-background fallback with local airport geometry. If geometry licensing or authoritative extraction is unresolved, record the affected layer as provisional and leave its release gate unmet; do not silently replace it with invented airport geometry.

## Verification and delivery

Implement in the master specification's M0–M5 order, allowing independent geometry and data-contract research after the baseline audit. Produce a task-level implementation plan after this design is approved.

Tests cover normalization, time units, missing values, duplicate/late data, freshness boundaries, interpolation gaps, optional prediction limits, phase scenarios, mode/clock isolation, feed errors, reconnect/epoch handling, bounded history, and origin checks. Use TDD for data-integrity logic. Verify visual changes in a browser, including selection, follow/loss, search, night mode, camera controls, responsive panels and asset/GPU failure fallbacks.

Run frontend typecheck/tests/production build and backend tests, then clean startup and source-archive checks. Record actual browser coverage and unmet checks. Performance targets, ten-viewer capacity, three 30-minute authorized live coverage windows and the two-hour soak require measured evidence; they cannot be claimed from a screenshot or a short smoke test.

Deliver runnable source, lockfiles, example configuration, README, copied goal, source/asset attributions, evidence and a clean ZIP. Local setup is the initial target; public deployment, paid services and provider replacement need separate scope decisions. Complete all locally achievable work even if external live-release gates remain blocked, and accurately label the delivered release status.

## Builder-owned choices and open gates

Builder may select supported pinned dependency versions, module names, component layout details, generic mesh construction, test tools and internal contract spelling while preserving the behaviors above. Do not ask the user to choose routine implementation details.

Open external gates: authorized provider contract and terms; verified Singapore coverage and timestamp semantics; authoritative geometry/reuse verification; permitted imagery/assets; measured performance, soak and browser compatibility. These are evidence tasks, not reasons to claim an offline prototype is a fully verified live digital twin.

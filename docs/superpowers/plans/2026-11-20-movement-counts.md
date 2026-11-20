# Changi daily detected movements

Goal: add today's landing/takeoff estimates to the existing Traffic panel, retaining Cesium and the Mac/GitHub Pages architecture. User requested proceeding after the offer of running counters; scope is Changi, Singapore calendar day. Implementation choices below are defaults, not claims of explicit user design approval.

Use the existing shared collector, runway geometry and observation history. Count only continuous, repeated live air/ground transitions near a Changi runway, with deceleration for landings and climb for takeoffs. Do not count disappearing aircraft, overflights, approach-only tracks, taxiing, demo flights or unknown ground state. Deduplicate repeated detection and brief state bounce. Sparse coverage means estimates and missed events.

Persist only minimal event identity/type/time and daily monitoring coverage in ignored local SQLite storage (standard library). Keep seven days locally, expose only today's aggregate counts through feed status. Provider secrets and observations are never published. Counters survive backend restart, start when monitoring begins, and roll over at Singapore midnight. No retroactive total. Track successful poll intervals separately; gaps and unmonitored time must be visible. Database failure must not stop the map or show misleading zero totals.

Alternatives: browser-only counts lose history on refresh; official monthly statistics cannot answer today; paid flight-status data conflicts with the requested free setup. Durable detected events are the smallest fit.

- [x] Backend: failing tests for confirmed transitions, false positives, dedup/restart, Singapore midnight, feed gaps and storage failure; implement movements.py, status contracts and collector integration.
- [x] Frontend: failing tests for counters, unavailable/stale/date rollover and demo isolation; implement compact MovementSummary in TrafficList and validate optional status payload.
- [x] Verify backend/frontend suites, both builds, browser desktop/mobile and Cesium; review change, update docs, restart only backend, commit/push and verify Pages.

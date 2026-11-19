# Singapore regional coverage adjustment

User request: show aircraft in the vicinity of Singapore and Changi; current count seems low.

Investigation: a single ADSB.fi 100 NM snapshot contained 20 positioned aircraft, with 10 within 25 NM and 14 within 50 NM. None reported ground state. Current adapter fixes radius to 25 NM. Normalization accepts all valid positioned records regardless of callsign or airline; frontend all-aircraft list excludes only lost records. No source-side completeness guarantee exists.

Decision: expand the fixed query to 100 NM (185.2 km), a regional vicinity encompassing Singapore and nearby Malaysian/Indonesian airspace. Retain one ten-second poller and existing bounded freshness/retention. Do not fabricate missing aircraft, change providers or import schedules as positions.

Steps:
- Update provider regression to require 100 NM and demonstrate acceptance of distant, unknown-callsign and ground records. Observe failure before changing adapter.
- Align range labels, source explanation, coverage ring and regional camera framing at 100 NM. Keep close runway/follow navigation and Cesium.
- Verify backend/frontend/build and browser regression using near-edge synthetic aircraft, plus all/ground/search filters and range label. Verify real live count and restart only own backend.
- Update docs/source package; independent read-only review; commit.

## Execution and review

Provider regression failed first at the old 25 NM URL, then passed at 100 NM, including distant, absent-callsign and ground records. The first edge-aircraft browser regression failed at zero visible and passed with a wider view.

Independent review caught fixed camera altitude cropping the region on wide/portrait screens. A 1440×800 regression reproduced two of four edge aircraft visible. The camera now fits a geographic rectangle through Cesium, with padding, rather than assuming a fixed altitude; both 1440×800 and 390×844 checks pass. The transition test now uses reduced motion and waits for a fresh render after 3D and Overview, addressing the associated stale-frame test weakness. No unresolved review findings. Source completeness remains bounded by receiver coverage; no promise of an aircraft census.

Completed: 54 Python, 24 frontend and 11 browser tests pass; typecheck/build pass; live viewer healthy with 20/20 regional aircraft in view. Source archive refreshed and CRC checked.

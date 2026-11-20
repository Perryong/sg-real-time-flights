# Changi route context and wider view

User approved the recommendation: free likely inbound/outbound labels, route context, 500 km coverage and official Changi board links, retaining Cesium. No airport feed access, paid subscription, schedules or exact ETAs are implied.

Use FlyItalyADSB's existing 30-second request with `with=route` and a 500 km radius. Keep ADSB.fi at 100 NM; clearly describe the differing source extents. Validate optional route data independently so malformed metadata cannot remove a valid aircraft. Route provenance is historical FlyItalyADSB, with callsign, observation count, last-seen day and retrieval time. Only metadata matching both ICAO identity and current callsign may enrich another source's position. Equal-position metadata updates must not renew position timestamps or add history.

Classify on the frontend using fresh airborne positions, usable speed/course, recent matching route evidence and course relative to Changi. Destination WSSS + course within 60 degrees toward airport => likely inbound. Origin WSSS + course within 60 degrees away => likely outbound. Everything else is unknown. Near the airport, existing approach/climb phase estimates remain separately visible; no inferred route changes movement counters. Source/callsign changes, stale data, missing metadata and demo cannot produce confident labels. Historical routes may be wrong today.

Traffic panel: add a labelled direction dropdown (all/inbound/outbound/unknown), compact row badges and usual route. Selected details explain evidence and show provenance/date/count. Link to official arrival/departure boards for boarding, gates and schedules; do not scrape or integrate the private website service. Map camera/ring and coverage badges use 500 km, including edge tests on desktop and phone.

- [x] Backend tests first: wider query, valid/invalid route parsing, cross-source matching, callsign mismatch and metadata-only updates. Add optional contract and regenerate schema.
- [x] Frontend tests first: conservative direction classifier, route validation, filtering/details/links, demo isolation. Update map extent and source descriptions.
- [ ] Full backend/frontend/build/browser checks, independent review, live smoke, commit/push, restart backend and verify Pages. Keep credentials and runtime database private.

# Regional weather verification

25 November 2026 (SGT).

- Backend: 235 tests passed, including model batch validation, provider credential isolation, old/new cache compatibility and real Redis concurrency, quotas and crash reservations.
- Frontend: 117 tests passed. Typecheck and Pages build passed.
- Weather browser checks cover desktop/mobile controls, explicit 500 km model/480 km radar labels, stale/expired data hiding, opacity, follow and coverage restriction.
- Existing aircraft-follow suite: six tests passed, including A350/777 display and model-load fallbacks.
- Live Vercel endpoints returned fresh 46-point regional wind and 480 km radar responses. No secrets or signed radar URLs were logged.
- The live desktop map rendered both overlays with 67 aircraft and no Cesium render errors. Drop pin, sky view, return and removal worked with weather enabled. Four-second software-rendered samples were 17 FPS without overlays and 16 FPS with overlays; these short samples do not predict hardware performance.
- Independent review found no additional correctness issues. Root fixed misleading waiting/error UI during 900-second backoff and reproduced a mobile postal-button overlap before applying the CSS fix. Regression tests cover both.

The grid requests 49 locations per 15 minutes, conservatively 4,704 location calls/day. Three boundary model cells were omitted in the live sample because their actual coordinates lay beyond 500 km. Glyph anchors use actual model coordinates; a 20 km symbol can extend outside the sampling circle. The 480 km radar uses approximate geographic rectangle placement because the provider supplies geographic bounds without a projected pixel extent. Model winds are 10 m surface estimates; no station observation or aircraft-altitude claim is made.

GitHub Pages publication and final public-site verification are performed after this local verification record.

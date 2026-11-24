# Weather layers verification

Date: 25 November 2026 (SGT). Issue #7.

The normal server HTTP client received HTTP200 from the official data.gov.sg wind speed, wind direction and 70 km radar endpoints without an API key. The deployed Vercel endpoint returned fresh data for 17 paired wind stations and a radar image with explicit bounds and expiry. CORS was verified for the GitHub Pages origin. Diagnostic Python urllib was rejected; no bypass or spoofed client headers were used.

Validation:
- Backend: 208 tests passed, including 37 weather tests and real Redis Lua coordination tests.
- Frontend: 100 unit tests passed. Pages build and typecheck passed.
- Weather browser tests: desktop and 390px mobile, independent toggles, default off, live-mode fixtures, radar image load, opacity, reduced motion, aircraft follow/exit and foreign-region restriction. Cesium render-error instrumentation remained clear.
- Observer regression: both browser tests passed, covering dropped pins, mobile postal lookup and sky view.
- Existing aircraft-follow suite: all 6 browser tests passed, including A350/777 and failed-model fallbacks.
- Independent review identified in-flight toggle cadence and long Retry-After timer overflow. Both were fixed with failing-then-passing regression tests.

Weather is off by default. The renderer never creates wind between reporting stations or interprets missing readings as calm. The radar image is placed over its supplied geographic bounds; its source projection is local azimuthal equidistant, so this rectangular overlay is an approximate geographic display, not precision navigation imagery. Stale or expired overlays are hidden.

The weather monthly budget is deliberately separate from the existing aircraft/location limits. Its 100,000 estimated Redis command units allow at most 3,125 admitted weather origin requests. CDN sharing reduces origin traffic, but there is no unlimited free-service guarantee. No paid resources or background collector were added.

A live browser check rendered 33 aircraft, 17 reporting wind stations and the real radar image with no Cesium render failure. A short software-rendered desktop sample measured about 19 FPS with layers off and 18 FPS with both on. These five-second samples are a smoke check, not a hardware performance guarantee. Visual inspection caught overlap between expanded weather details and zoom controls; the desktop panel was moved left and the browser test now clicks zoom with both overlays enabled.

The first Pages CI run exposed a test-only concurrency assumption on Linux: the first scheduled request need not win the Redis lease. The fencing assertion now uses whichever response contains a fresh frame instead of serializing the first result, which may be an expected pending-update exception. Application code is unchanged.

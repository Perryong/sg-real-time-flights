# Location pin and observer views

User chose both nearby aircraft and a 3D sky view from a Singapore pin and explicitly requested proceeding. Continue the established free cloud + Pages + Cesium setup.

One pin per browser tab, placed by an explicit Drop pin mode or a six-digit postal-code lookup. Keep leading zeroes. Picking an aircraft normally still selects it. Pin placement is limited to the Singapore vicinity (1.15–1.48 N, 103.59–104.11 E; this includes coastal waters, not a legal boundary). Pin is session-only, never in URLs or flight-feed payloads. Postal searches are explicitly submitted to OneMap via the backend; credentials remain server-side. No automatic GPS permission.

Nearby list: airborne aircraft within 25 km, nearest first, horizontal distance and compass bearing; exclude stale/unknown position timing, clearly label simulated mode. Show altitude and approximate elevation where available. Sky view stays at pin, with adjustable view height above the map (default 2 m, 2–500 m), heading/pitch controls, and Look at aircraft. Unknown altitude cannot be aimed at. Returning to map restores ordinary navigation; following an aircraft exits sky view. No visibility guarantee: flat ellipsoid, no building obstruction, generic aircraft models, uncertain source altitudes. No AR, weather or notifications.

Implementation: reuse Cesium globe picking/entities/camera plus existing tracks and layout. New small observer math + panel modules. OneMap search has free API access but now needs registration/authentication; no credentials found. Ask user about account while completing independent UI. Backend uses validated exact-postal results, bounded requests and private token caching. If unavailable, retain pin and show actionable search error. Do not fabricate geocodes or claim postal search live before configured.

Test distance/bearing/elevation, invalid/stale inputs, pin replacement/removal, postal error/race handling, sky/map transitions, aircraft selection and responsive browser flow. Test backend provider errors/auth and input bounds. Review before deployment. No additional paid service.

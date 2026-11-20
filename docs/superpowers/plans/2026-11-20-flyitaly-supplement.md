# FlyItalyADSB regional supplement

User supplied a free API key after agreeing to test coverage and connect it if it adds useful aircraft. The first authorized request succeeded and returned three identities absent from the current ADSB.fi snapshot, with zero ground reports.

Scope: reuse the bounded readsb adapter with the provider-specific private header, kilometres and seconds; add a third independently scheduled source at 30 seconds; retain newest-position deduplication, source resets and Cesium; add attribution/status and synthetic regression coverage. No dependencies, public deployment, or change to the OpenSky permission gate. Secrets remain only in ignored local configuration.

Backend four new tests failed before implementation, then passed with the full 89-test suite. Frontend attribution failed before implementation, then passed with the full 28-test suite. Browser verification, live activation and source-archive secret exclusion follow.

Complete: fresh review found no blockers. 89 backend + 28 frontend + 13 browser checks passed; typecheck/build passed. Local activation verified two healthy sources, 24 unique aircraft at 19:56 SGT, no ground reports, and zero OpenSky polling. Source/bundle credential scans and source archive CRC/content/secret checks passed.

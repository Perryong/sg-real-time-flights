# One-hour rain radar playback verification

25 November 2026 (SGT).

- Backend: 278 tests passed, including 43 history cases covering midnight, missing/duplicate/expired frames, response validation, shared Redis quotas, leases, denial and stale snapshots.
- Frontend: 135 tests passed; typecheck and GitHub Pages build passed. Tests cover history parsing, expiry, selection, looping, hidden-tab pause, image-load acknowledgement, failure, cache bounds and obsolete loads.
- Browser: three weather scenarios passed on desktop/mobile, including playback, seek, pause, Return to Live, aircraft follow, mobile postal/sky view and coverage restriction. Six aircraft-follow regression scenarios also passed.
- Independent review approved after fixing Pause during a pending image load; the regression failed before the fix and passed after it.
- An existing Redis global-budget test crossed a wall-clock minute during verification. It now retries only across a changed Redis minute with isolated keys, preserving the original assertion. No production rate-limit change was made.
- Safe source-only Vercel export deployed successfully. The production history endpoint returned HTTP 200, fresh state, 480 km coverage and 13 actual frames.
- A real browser used the deployed backend: the hour ran from 15:05 to 16:05 SGT; Play advanced the shown image from 15:05 to 15:10, seek displayed 15:40, and Return to Live cleared the history banner after loading current rain. 64 live aircraft remained displayed. Desktop/mobile screenshots were visually inspected; no page errors, Cesium render failure or horizontal overflow occurred.
- No credentials or signed image URLs were recorded in these results.

Playback is historical rain only. Aircraft remain live. Missing observations are omitted, expired URLs and snapshots older than 15 minutes are hidden, and the provider's geographic bounds remain approximate placement for its azimuthal-equidistant raster. Playback adds a shared history request every five minutes only while open; the existing free weather allowance and request limits remain enforced.

GitHub Pages publication and public-site verification follow this record.

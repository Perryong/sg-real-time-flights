# Live-provider switch — approved for personal use

Approved by the user: proceed with ADSB.fi for the personal tracker and keep Cesium 3D. Implement directly in the existing tracker; do not import WorldMonitor code. Replace the unused Airplanes.live adapter rather than introducing a provider framework. Local `.env` enables live polling with explicit personal-use acknowledgement; distributed defaults stay off.

The selected Airplanes.live API refuses the unauthenticated Changi query with HTTP 403. The user has no provider account/access yet.

## Candidate: ADSB.fi

Its [official API documentation](https://github.com/adsbfi/opendata/blob/main/README.md) documents a public v3 geographic endpoint, maximum radius 250 NM, and a public request limit of one per second. Use is restricted to personal, non-commercial purposes; cite ADSB.fi and link to its homepage. The service is provided without a warranty and access can be suspended.

A single read-only query to `https://opendata.adsb.fi/api/v3/lat/1.3644/lon/103.9915/dist/25` returned HTTP 200 and 13 positioned aircraft on 19 November 2026 at approximately 17:30 SGT. The `now` field was in milliseconds. No raw aircraft data was retained. Sustained coverage and field validation remain to be checked during integration.

## Proposed implementation after selection

- Select the named provider through validated backend configuration; keep the host/path fixed, with no automatic provider fallback. Poll at ten seconds with the existing shared loop, bounded history and backoff.
- Convert milliseconds explicitly and namespace real observations as `live:adsb.fi:<id>`. Preserve timestamp validity, original altitude references, nullable data, and synthetic-mode isolation.
- Show ADSB.fi attribution and link in the traffic/source UI, including the personal-use restriction. No data redistribution archive or public deployment.
- Add mocked adapter/configuration/provenance regressions, verify the live snapshot and WebSocket in the running viewer, and update documentation/source archive.

The approved original design explicitly reserved provider replacement for a separate user decision. This proposal does not authorize commercial use or enable the alternative feed.

## Other public options considered

[ADSB.lol's current docs](https://www.adsb.lol/docs/open-data/api) list 500 requests/day without a key. Continuous ten-second polling would need 8,640 requests/day, so it does not fit this setup without a higher quota. [OpenSky's REST docs](https://openskynetwork.github.io/opensky-api/rest.html) list 400 daily anonymous credits; a small area costs one credit, also insufficient for continuous ten-second polling. Neither alternative was integrated.

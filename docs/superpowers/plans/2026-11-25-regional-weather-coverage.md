# Regional weather coverage implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task; tests before behavior. Root integrates and performs Git/deployment actions.

**Goal:** Expand the Singapore weather display to observed 480 km radar and modelled 500 km surface winds.
**Architecture:** Add independent `wind_regional` and `radar_wide` weather layers to the existing fixed-feed Vercel endpoint. They share existing monthly weather allowance and rate counters, but have independent cache/lease/denial keys. Retain legacy layers for open older clients. New frontend uses the new layers and explicit model/range labels.
**Tech stack:** FastAPI, httpx, Upstash Redis, React, TypeScript, Cesium; no new paid service or dependency.
**Spec:** docs/superpowers/specs/2026-11-25-regional-weather-coverage-design.md, approved by user: “Proceed with the implementation.”

## Global constraints

- Keep Cesium 3D, free hosting, controls, follow and location pins. No Mac backend dependency.
- Radar480km uses official geographic bounds, never stretched70km data. The supplied rectangle remains an approximate placement for the local azimuthal-equidistant image; do not claim navigational precision.
- Regional wind is modelled10m surface wind, never measured stations or aircraft-altitude wind.
- Fixed grid with at most81 points, one batch per15minutes, hidden tabs pause. Missing points remain absent. Regional wind cadence900s/fresh age1800s; radar cadence300s/fresh age900s.
- Retain existing Redis monthly/rate limits and persistent denial. New layer keys avoid interpreting cached70km data as480km.

## Contracts

`layer=wind_regional` returns common WeatherEnvelope `{state,observed_at,fetched_at,retry_after,message}` plus `{layer:'wind_regional',kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:[{id,lat,lon,speed_mps,from_deg}]}`. For this model layer, observed_at carries model valid time, explicitly labelled “Valid” in the UI. This retains common envelope handling without pretending model points are observed stations.

`layer=radar_wide` returns common envelope plus `{layer:'radar_wide',range_km:480,radar:null|RadarFrame}`. RadarFrame fields remain `{url,west,south,east,north,observed_at,expires_at}`. Current official480km bounds W99.638609 E108.290871 S-2.967382 N5.657912. Validate fixed-product bounds tolerantly and reject70km payloads. Existing wind/radar response contracts stay unchanged.

Frontend `WeatherLayer` adds both new names. `WindPoint={id,lat,lon,speed_mps,from_deg}`, `WindStation extends WindPoint {name}`. `addRegionalWindLayer(viewer:Viewer,points:WindPoint[],reducedMotion:boolean):()=>void` draws bounded non-pickable regional arrows with cleanup, static reduced-motion and calm indicators; existing addWindLayer remains for station tests. MapScene passes the new points explicitly and calls the new renderer. Radar renderer unchanged unless inspection reveals a required fix.

## Review focus

- Old cached70km images and old clients: separate layer keys; reject incorrect product range; keep legacy API.
- Provider denial/429/missing values/unit mismatch/model point relocation: bounded retries, validation and absent points, no synthesized readings.
- Quotas and cache races: count multi-coordinate calls conservatively, same shared monthly allowance, regional cadence survives crashes.
- Model timestamps, stale/expired data: valid-time label, hide unavailable values, respect provider response times.
- Regional glyph scaling and navigation: real Cesium render checks, no picking interference, cleanup, mobile/follow/pin regression.

## Task1: backend (backend worker)
Files: backend/app/weather.py; optional focused backend/app/regional_weather.py; backend/tests/test_weather*.py and/or new test_regional_weather.py. Own no frontend or docs.
- [x] Write failing tests for49-point fixed geodesic grid within500km, model units/time/coordinates/missing data,480km metadata, legacy compatibility and new-layer Redis coordination.
- [x] Run targeted tests and confirm meaningful failures.
- [x] Implement fixed Open-Meteo multi-location current wind query (m/s,10m speed/direction,nearest cells,UTC epoch,forecast_days1), independent new layer coordination and fixed480km NEA feed. Keep provider credentials scoped to NEA only.
- [x] Run complete backend suite, including real Redis tests, report exact counts and public endpoint probe result without signed URL output.

## Task2: Cesium regional wind renderer (renderer worker)
Files: frontend/src/scene/weather.ts, weather.test.ts only. Consumes WindPoint from root types.
- [x] Add failing tests for regional glyph length (20km) and calm radius2km, direction, reduced motion, cleanup and non-pickability; keep legacy900m station glyph behavior.
- [x] Implement addRegionalWindLayer via shared internal geometry builder, no new loop or viewer, existing color palette.
- [x] Run scene tests. Inspect wide radar projection metadata/documentation and report limitations; do not invent projected pixel extent or alter georeferencing without evidence.

## Task3: frontend integration (root)
Files: frontend/src/data/weather.ts/tests, weatherPolling.ts/tests, hooks/useWeather.ts as needed, App.tsx, MapScene.tsx, WeatherControls.tsx, SourceDetails.tsx, README.md, browser tests.
- [x] Add failing parser/freshness/cadence tests for model points and480km range; retain legacy tests.
- [x] Implement contract validation,900s model cadence, new layer requests, model validity/range/attribution UI and regional renderer wiring. Keep preferences unchanged.
- [x] Update browser fixtures to new contracts; verify expanded geographic bounds and model labels, independent toggles, opacity, foreign region restriction, real rendering, follow and pins.

## Task4: release (root)
- [ ] Whole-change independent review, fix confirmed findings; full backend/frontend suites, typecheck/Pages build and targeted browser checks.
- [ ] Safe Vercel source export and production deploy; verify legacy and new endpoints, real480km image and model grid.
- [ ] Commit/push branch, PR, merge, watch Pages CI/deployment; public desktop/mobile weather smoke check. No secrets in source or logs.

## Execution ledger

- Backend235tests passed; frontend117tests passed; Pages build/typecheck passed.
- Review: no additional correctness issues. Root fixed misleading loading status during long retry delays, with failing-then-passing hook tests including visibility restoration.
- Ruling: the500km circle limits model sample locations, not glyph extent. Regional arrows remain anchored at supplied coordinates; shifting them inward would misplace data.
- Ruling: retain approximate radar rectangle placement. Provider supplies geographic bounds and local AEQD projection metadata, but no projected pixel extent; inventing a reprojection would add false precision. UI/source documentation states the limitation.
- Backend uses a spherical great-circle grid and500km distance check consistent with the existing map's kilometre-radius convention; it does not claim survey-grade WGS84 ellipsoidal distances.
- Free-provider probes returned46usable cells from49requests, with3out-of-radius cells omitted. Legacy/new cache contracts tested independently, including wrong-layer cachedframes and15minute crash reservations.

- Live desktop smoke: fresh HTTP200 wind_regional46points and radar_wide480km,67aircraft rendered, no Cesium errors; drop pin/skyview/return/remove with overlays active passed. Four-second software-rendered samples17FPS off/16FPS on are smoke evidence only.
- Mobile inspection found expanded weather details intercepting postal Find. Reproduced with a browser test; hide expanded details while the mobile side panel is open, retain toggles and restore details with the map/follow view.

# Aircraft Follow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, inline with one final independent review.

**Goal:** Publish the reference-style 3D following view and bounded international coverage.
**Architecture:** Shared buffered follow sample feeds the camera/model/HUD. Existing cloud collector gains fixed regional scopes and shared rate budgets.
**Tech Stack:** React/TypeScript, Cesium, FastAPI/Redis. No new dependencies.
**Spec:** docs/superpowers/specs/2026-11-24-aircraft-follow-design.md

## Global Constraints
Free plans, no Mac collector, no camera/GPS, no secrets in frontend. Keep observer view and Changi counts intact. Preserve stale/unknown distinctions and source attribution.

## Review Focus
- Stale report freezes both camera and model without fabricating altitude.
- Heading wraps, model orientation and buffered telemetry agree.
- Follow exit, selection change, renderer failure and mobile controls restore navigation.
- Global budgets cannot be multiplied by switching regions; history and counts stay isolated.
- Unknown route/imagery/provider failure remains usable and truthful.

### Task 1: Follow view
Files: new frontend/src/data/follow.ts and tests; new components/FollowPanel.tsx; scene/aircraft.ts, scene/MapScene.tsx, App.tsx, styles.css; e2e/follow-pages.spec.ts.
Interfaces: followSample(track, now) returns valid buffered pose/measurements or null; FollowCamera {distance,orbit,elevation}; same sample used by renderer and camera. Region interface added in Task 2.
- [x] Write tests for shortest-angle heading, same-time altitude/speed, stale/future/unknown-altitude refusal and ground-state eligibility; observe failures.
- [x] Implement sample and dedicated camera/HUD, preserve return camera, block default double-click tracking during follow.
- [x] Add optional satellite backdrop with attribution/fallback after license/endpoint verification.
- [x] Run frontend tests, typecheck/build, desktop/mobile follow transitions and simulated lost/stale cases. Commit.

### Task 2: Bounded regions
Files: backend/app/regions.py, cloud.py, cloud_cache.py, tests/test_regions.py; frontend/src/data/regions.ts, hooks/useTraffic.ts, App.tsx, MapScene.tsx, TrafficList.tsx.
Interfaces: region id singapore|london|tokyo; endpoint /api/aircraft?region=id (default Singapore); cache rate_prefix independent of data prefix; frontend regions contain name/center/radius.
- [x] Add failing tests for region validation, budget sharing, state isolation and foreign counts/phase suppression.
- [x] Implement fixed provider URLs, preserve Singapore ledger, keep only requested region polling; frontend changes clear old selection/snapshot and move regional camera.
- [x] Test delayed response switching and public cloud fixture behavior; run full suites. Commit.

### Task 3: Release
- [ ] Independent review, fix important findings with regressions.
- [ ] Deploy isolated public-source Vercel package, verify Singapore and foreign-region responses without exposing credentials.
- [ ] PR closes #5, merge, wait for Pages, verify live follow and observer regression. Record evidence and limitations.

## Execution record
Ruling: user approved the issue and requested implementation; preserve the established inline/branch/review/publish workflow without another approval loop.

## User steering: release paused
On November 24 the user requested no further Git commits and chose aircraft-specific A350/777 models. The model extension and four review fixes remain local and uncommitted. Draft PR #6 still contains only 9be6df6; no merge or Pages release has occurred. Backend regional support had already been deployed before the pause. See the aircraft-models spec for the revised local scope.

## Local realism extension
On November 24, the user requested 3DStreet and Polyfork catalog integration while retaining the no-commit restriction. The four aircraft representations now adapt Polyfork's CC BY 4.0 Widebody Airliner mesh, with smoothed surfaces, stowed gear and approximate proportions. The EOX 2017 placeholder imagery is replaced by the 2024 layer under CC BY-NC-SA 4.0. Cesium renders the CC0 Poly Haven sky referenced by 3DStreet, camera-side daylight and a purple observed trail. No 3DStreet application code or second rendering engine was added. Overpass building queries failed; no extra buildings were added. The current terrain is flat and imagery historical.

Local verification for the realism extension: 82 frontend tests, 171 backend tests, typecheck and Pages build passed. Four follow browser flows passed again after the final lighting change; both observer browser flows passed. Manual inspection checked satellite tiles after loading, the sky at a low camera elevation, smoothed aircraft shading and the observed trail. Screenshot: /tmp/changi-realistic-follow-local.jpg. Preview is http://127.0.0.1:4177/sg-real-time-flights/. HEAD remains 9be6df631c753d1d940729ea838a7eebf9be3bee; all extension changes are uncommitted and unpublished.

## Commit and push authorized
The user subsequently requested proceeding with the next steps and pushing the code. This supersedes the earlier local-only restriction for committing and pushing the feature branch. Fresh verification passed: 82 frontend tests, 171 backend tests, TypeScript and Pages build. The existing PR #6 will receive the updated implementation and description. The GitHub Pages workflow deploys only from main; this feature-branch push does not publish the site.

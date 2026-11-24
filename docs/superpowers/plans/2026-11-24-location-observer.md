# Location Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, inline execution with final independent review.

**Goal:** Place a Singapore pin by postal code or map and observe nearby aircraft on map and sky view.
**Architecture:** Browser-local pin and geometry calculations; Cesium camera stays at pin in sky mode. Authenticated OneMap lookup through existing backend.
**Tech Stack:** React/TypeScript/Cesium, FastAPI/httpx/Redis; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-24-location-observer-design.md

## Global Constraints
Free services; keep current flight feed, limits, daily counts and Cesium. Pin is session-only. OneMap credentials never reach frontend. New account completion needs the user.

## Review Focus
- Stale or absent positions/altitudes must not appear as current visible aircraft.
- Sky camera must remain at pin and restore navigation on exit.
- Pin mode must not break normal aircraft selection or geometry visibility.
- Postal lookup races/errors must not replace a newer pin or expose credentials.
- Narrow mobile view must keep controls reachable.

### Task 1: Observer math, panel and Cesium camera
- [x] Write failing tests for geographic bearings/distance/elevation, fresh-airborne filtering, postal UI errors and pin actions.
- [x] Add frontend/src/data/observer.ts and components/ObserverPanel.tsx; wire App state and MapScene pin/camera controls. Add accessible styling.
- [x] Run frontend tests/typecheck and Pages browser flow for dropped pin, nearby selection, sky camera and return/removal. Commit.

### Task 2: Postal lookup and verification
- [x] Add failing backend OneMap exact-postal/auth/error/rate-limit tests; implement backend/app/geocoding.py and route on both cloud/local apps.
- [x] Configure authorized OneMap credentials after account setup; user selected a production access token with manual renewal.
- [x] Run backend/frontend suites and builds/browser checks. Independent review, address findings with regressions. Deploy and merge through established workflow.


## Verification record · 24 November 2026

- Backend: 162 tests passed, including actual Redis limiter execution, token reuse/backoff, exact postcodes, provider errors and malformed authentication responses.
- Frontend: 63 tests passed; TypeScript and GitHub Pages/preview builds passed.
- Browser: two observer flows (desktop drop pin and mobile mocked postal lookup) and existing cloud-feed/Cesium selection regression passed.
- Native preview verified against the existing live cloud feed: sample dropped pin, nearby distances and direction, Look at aircraft, fixed sky viewpoint. Postal lookup has only mocked-provider verification until account configuration.
- Final independent reviewer found camera double-click bypass, delayed render/aim mismatch, and mobile selection overlap. Added regressions, observed failures, fixed the causes, and reran suites. Camera guard preserves default double-click outside sky/placement; sky rendering uses the same latest observation as aiming; explicit aircraft selection leaves sky and My spot clears aircraft details.
- Also showed requested altitude and removed the map-only IN VIEW count from sky, where it would be misleading. No deferred code findings.
- Ruling: continue with a local preview and commit while OneMap access is pending. This preserves the working drop-pin and sky flow without pretending live postal lookup works. Cost: postal searches remain unavailable until credentials are configured and tested; public deployment is still pending.
- Final reviewer declined live OneMap verification because no account credentials exist; this remains an explicit external dependency, not a passing check.


## Published release · 24 November 2026

- User completed OneMap registration and authorized a production access token. Stored only as a Vercel Secret, never in source or frontend assets. User explicitly chose manual token renewal; current expiry is 27 November 2026, 11:29 AM SGT.
- Added token-only configuration with regression tests for safe failure/backoff, token rotation and route configuration. Automatic email/password renewal remains supported but is not configured. Focused independent release review found no important or critical issues.
- Final backend suite: 165 passed; frontend suite: 63 passed. Pages CI passed.
- PR #4 merged at ce7336754f439c8f19f148a980c23f5d7a68ef60. GitHub Pages run 45320360597 succeeded.
- Vercel deployment dpl_Fb9jg8a8hjaT9ZifqrWqaQjkzAsx is live at the existing production alias.
- Production POST postal lookup returned HTTP 200, exact OneMap address/coordinates, no-store and the expected Pages CORS origin. Verified the user-requested postal code in the published UI, centered the resulting pin, saw nearby real aircraft distance/direction/altitude, and entered sky view from that location. No user location was saved in repository artifacts.
- The earlier account/deployment blocker is resolved; the only ongoing setup requirement is manual token renewal as chosen by the user.

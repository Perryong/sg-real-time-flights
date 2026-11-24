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
- [ ] Configure authorized OneMap credentials if user has completed account setup; otherwise make setup blocker explicit while retaining completed pin flow.
- [ ] Run backend/frontend suites and builds/browser checks. Independent review, address findings with regressions. Deploy and merge through established workflow when all required access is available.


## Verification record · 24 November 2026

- Backend: 162 tests passed, including actual Redis limiter execution, token reuse/backoff, exact postcodes, provider errors and malformed authentication responses.
- Frontend: 63 tests passed; TypeScript and GitHub Pages/preview builds passed.
- Browser: two observer flows (desktop drop pin and mobile mocked postal lookup) and existing cloud-feed/Cesium selection regression passed.
- Native preview verified against the existing live cloud feed: sample dropped pin, nearby distances and direction, Look at aircraft, fixed sky viewpoint. Postal lookup has only mocked-provider verification until account configuration.
- Final independent reviewer found camera double-click bypass, delayed render/aim mismatch, and mobile selection overlap. Added regressions, observed failures, fixed the causes, and reran suites. Camera guard preserves default double-click outside sky/placement; sky rendering uses the same latest observation as aiming; explicit aircraft selection leaves sky and My spot clears aircraft details.
- Also showed requested altitude and removed the map-only IN VIEW count from sky, where it would be misleading. No deferred code findings.
- Ruling: continue with a local preview and commit while OneMap access is pending. This preserves the working drop-pin and sky flow without pretending live postal lookup works. Cost: postal searches remain unavailable until credentials are configured and tested; public deployment is still pending.
- Final reviewer declined live OneMap verification because no account credentials exist; this remains an explicit external dependency, not a passing check.

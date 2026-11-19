# Release evidence — 19 November 2026

This is a runnable local geographic tracker preview. Live observations and authoritative geometry accuracy are not certified. No public deployment or external aircraft requests were made.

## Current verification

- Python unit/integration suite: 42 passing.
- Frontend unit/component suite: 17 passing; typecheck and production build pass.
- Chromium browser suite: 7 passing before final review; final rerun pending.
- Five-minute shared-service test: 100 synthetic aircraft, ten ASGI clients, 60 shared polls; p95 receipt-to-client 0.496 s. This measures an in-process ASGI transport, not deployed network latency.
- Two-hour scenario-time backend soak accelerated into 36.42 seconds: bounded identities/history, final-hour memory ratio 1.007. This is not a two-hour wall-clock or browser soak.
- Five-minute 100-aircraft development-build browser test: 15.66 FPS using SwiftShader at 1920×1080; did not meet 30 FPS. Profiling identified hidden dynamic trails and React development work. Unselected trails now have no geometry; a production-build rerun is pending. These conditions are not a hardware-GPU reference benchmark.
- Safari 26.5.2 is installed, but WebDriver rejects sessions because remote automation is disabled. No settings were changed. Safari smoke is unverified. Microsoft Edge is not installed. Installed Chrome check is pending.

## Acceptance gates

| Gate | Status | Evidence / limit |
| --- | --- | --- |
| AC-01 reproducible install/build | Pending clean archive check | Lockfiles, runtime selectors, commands in README |
| AC-02 authorized live feed | Unmet | `provider-contract.md`; access, units, terms and Singapore coverage unverified |
| AC-03 authoritative thresholds | Unmet | `geometry.md`; licensed community geometry is provisional, not a source-precision exemption |
| AC-04 observation details | Pass on fixtures | Component tests; original date/time, age, altitude reference, provider, display method |
| AC-05 interpolation | Pass | Clock-controlled tests; 21-second gaps rejected |
| AC-06 bounded prediction | Pass | Disabled by default, opt-in five-second bound tested |
| AC-07 freshness | Pass | Exact boundary tests, cached-position and heartbeat/loss tests |
| AC-08 failure/recovery | Pass on mocks | Provider, stream and browser tests; no live operational validation |
| AC-09 inferred phases | Partial | Synthetic inference rules tested; real track accuracy and complete operational validation unverified |
| AC-10 follow/day/night | Pass on Chromium | Browser selection, follow, Escape, loss and lighting tests |
| AC-11 mode isolation/playback | Partial | Live/demo flows and scenario clock tests pass; recorded fixture contract exists, no public recording selector |
| AC-12 asset/height fallback | Partial | Model/WebGL failure tests; ellipsoid fallback. Terrain-provider failure is not exercised because no external terrain is configured |
| AC-13 performance/soak | Unmet | ASGI latency passed; development FPS failed, production rerun pending; two-hour wall-clock browser soak not run |
| AC-14 secrets/attribution/origins | Pending archive scan | Backend-only token configuration; origin tests, escaped text tests, licenses included |
| AC-15 source archive | Pending clean run | Explicit allowlist packaging includes root goal.md |

## Scope decisions

- Started an isolated feature branch in the empty project, rather than a second worktree; no existing work was displaced.
- A verified-access flag and explicit timestamp units represent the single provider contract. The operator must verify both before enabling polling; this does not establish provider authorization by itself.
- CAAS redistribution permission is unresolved. Distributed geometry comes from OSM and OurAirports with their licenses; authoritative precision remains unmet, and inference remains provisional.
- Community import consistency is tested to its own precision. The authoritative 2 m / 5 m / 0.1° targets are not waived or silently loosened.
- Demo history is 60 seconds to limit fixture size; live history remains 300 seconds. Demo trails are shorter.
- Ports 8017/5177/4177 avoid unrelated services on 8000/5173.
- Scene and interface were integrated together because camera/selection and fallback verification require the complete UI. Their browser checks remain separate.
- No merge/push/deployment is needed for this newly initialized local repository; retain `feat/changi-tracker` and the source archive.

## Remaining validation

The preview must not be described as a verified realtime feed, authoritative airport digital twin, proven 30-FPS application, or a two-hour stability-certified release. Complete the external provider/geometry gates and supported-browser/hardware measurements before making those claims.

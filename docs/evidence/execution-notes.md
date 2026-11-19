# Execution decisions and validation record

# SDD ledger — plan: docs/superpowers/plans/2026-11-19-changi-tracker.md
Execution: Native approved by 'Proceed the next step'.
Pre-flight: Tasks 1→2/4/5 share Observation/Snapshot; matching names and seconds units.
Pre-flight: Tasks 3→4/6 share AirportManifest/GeoJSON; sourced geometry required.
Pre-flight: Tasks 4→5→7 use generated fixture frames, isolated scenario clock and frontend selection.
Pre-flight: Tasks 5→6→7 share stable track identities and display-time policy.
Pre-flight: Tasks 1–7→8 share commands/evidence. No interface conflicts found.
Ruling: Initialize a feature branch in the empty current project rather than another worktree — no existing project branch needs protection — no user changes displaced.
Task 1: complete (commits e1a075d..6f4a47b, tests: .venv/bin/python -m pytest -q → 14 passed in 0.03s)
Task 2: complete (commits 6f4a47b..6c3aee7, tests: .venv/bin/python -m pytest -q → 28 passed, 1 warning in 0.19s)
Task 3: Ruling: CAAS redistribution permission is unresolved under its published restrictive terms. Ship provisional licensed OSM taxiways/buildings and Unlicense OurAirports runway facts, with visible source/precision limitations; do not bundle CAAS charts or call geometry authoritative — permits a runnable sourced viewer without implying the final geometry gate passed — authoritative threshold certification remains blocked.
Task 1: Ruling: Provider contract verification is represented by an explicit boolean plus configured response units instead of a larger ProviderContract class — one provider and two supported time units need no hierarchy — operator must verify settings before enabling live.
Task 3: Ruling: Source comparison exposed community bearings 22.848–22.941 degrees rather than published 23.02. Test import consistency against community integer 23° with 0.25° tolerance; retain authoritative 0.1° gate as UNMET — changing the coordinates to make a test pass would fabricate accuracy — runway inference stays heuristic/provisional.
Task 3: implemented and tested provisional geometry (30 passing tests); authoritative/reuse precision gate remains blocked. Browser validation pending Task 6.
Task 4: Ruling: Demo frames contain 60 seconds of recent history to keep the bundled scenario small; live storage retains 300 seconds — all fixture timestamps and phases still use the same pipeline — shorter demo trails only.
Task 4: complete (commits f680c55..14c1e7d, tests: .venv/bin/python -m pytest -q → 40 passed, 1 warning in 0.27s)
Task 5: complete (commits 14c1e7d..9879417, tests: npm --prefix frontend test →    Duration  121ms (import 44%, transform 20%, tests 19%, worker 17%))
Task 6: Ruling: Ports 8000 and 5173 are occupied by existing services; use backend 8017, frontend 5177 and preview 4177, update origins and setup docs consistently — preserve unrelated user processes — alternate ports must be used in startup.
Task 6/7: Ruling: Integrate scene and interface together because selection, camera and failure fallback require a complete UI — both retain their own browser specs — combined commit is larger to review.
Task 6: implemented; seven browser checks passed before final camera/trail corrections; final verification pending.
Task 7: implemented; 17 unit/component tests pass; final browser verification pending.
Task 8: Ruling: Use npm ci from inside frontend for clean installation — npm 11.20 --prefix on the macOS /var symlink path falsely requests frontend@0.1.0 despite matching lockfile — avoids platform path resolution failure without changing dependencies.
Final review: independent read-only review by gpt-6.2-astra; six Important findings accepted, no Critical findings.
Final: fixed lost approach context — sequential landing/go-around tests RED→GREEN; bounded private context expires after 60 seconds and resets across sessions.
Final: fixed REST worker-thread mutation race — concurrent expiration plus next websocket polls RED→GREEN; state readers run on owner event loop.
Final: fixed queued sleep/wake heartbeat clock rewind — both event orderings and obsolete callbacks RED→GREEN; immediate invalidation and non-rewinding server offset.
Final: fixed newer ground report overriding buffered altitude — scene tests RED→GREEN, including marker-only fallback for an unknown-height bracket.
Final: fixed renderer failure leaving follow active — WebGL startup and context-loss E2E RED→GREEN.
Final: fixed misleading RAF benchmark — instrument actual Cesium postRender events and entity/view counts; induced context loss exits 1 with valid=false.
Final: minor (deferred): Map labels retain an aircraft's first callsign while the list can show an updated callsign.
Final: minor (deferred): Day imagery errors lack the specific warning attached to night imagery; geometry/list remain usable.
Final: minor (deferred): Details omit separate interpolation-bracket times and receipt time for unknown-timing observations.
Final: Ruling: Provider authorization/contract/coverage cannot be judged from code — keep live gated and describe preview as synthetic-capable only — actual live monitoring remains unavailable until independently verified.
Final: Ruling: Authoritative runway precision/operational status cannot be judged from community data — leave gate unmet, clearly disclose provisional geometry — runway assignments may differ from authoritative positions.
Final: Ruling: Performance, clean install and stability require measurements — use observed results and mark missing/failed gates, not reviewer inference — preview is not a certified production release.
Task 6: complete within disclosed preview scope (9879417..de74799); three scene E2E plus five integrated tracker tests pass, native Chrome views inspected, typecheck/build pass. External terrain not configured; authoritative accuracy remains unmet.
Task 7: complete within disclosed preview scope (9879417..de74799); 21 frontend tests and eight browser tests pass. Recorded-contract fixture exists without a public historical selector; AC-11 remains partial.
Final: green suite 45 backend + 21 frontend + 8 browser tests; production build/typecheck pass after the one fix pass.
Task 8: clean archive install/build/run passed; temporary services stopped. Final actual-render performance measurements pending completion.
Task 8: complete within local preview scope; final scene benchmark 59.47 FPS/100 visible aircraft/300 sec, backend p95 0.366 sec/10 clients/60 shared polls, clean archive run passed. Live, authoritative geometry and wall-clock soak gates remain explicitly unmet.
Final: Ruling: Keep newly initialized feat/changi-tracker local with no remote/base branch — approved scope is local implementation and ZIP, not integration/publication — no shared deployment is created.

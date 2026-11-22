# Cloud Daily Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain daily detected Changi movement counts in the free cloud tracker.
**Architecture:** Serialize the existing in-memory movement ledger into the lease-protected shared state; render current-day summaries on every response. Reuse the existing UI with explicit viewing-only coverage.
**Tech Stack:** Python/FastAPI/SQLite, Redis REST/Lua, React/TypeScript, Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-22-cloud-daily-counts-design.md

## Global Constraints
Free existing services only; no Mac, new dependency or background collection. Keep Cesium. Seven Singapore calendar days. No backfill or official-total claim. Existing 20-second sampling gap and 120-second duplicate rules remain.

## Review Focus
- Old cached snapshots and midnight: never label yesterday’s totals as today.
- Expired lease or failed publish: never lose or duplicate previously saved counts.
- Failed sources/cached observations: never inflate coverage or count the same event twice.
- Corrupt ledger: unavailable rather than silently resetting saved counts.
- Browser pause/reconnect: retain today’s saved totals and show unmonitored time.

### Task 1: Persist movement ledger with the shared snapshot
**Files:** backend/app/movements.py, backend/app/cloud.py, backend/tests/test_movements.py, backend/tests/test_cloud.py.
**Interfaces:** MovementLedger.export_state() -> dict; restore_state(state: dict) -> None. JSON contains events, coverage and continuity. CloudFeed.render updates MovementSummary for current Singapore day.
- [ ] Add failing tests: restore/duplicate/coverage/retention/corrupt state; cloud instances, concurrent cached readers, failure recovery, midnight and migration. Run `.venv/bin/python -m pytest backend/tests/test_movements.py backend/tests/test_cloud.py -q`; expect failures for missing persistence.
- [ ] Implement minimal validated JSON export/restore; restore before polling and atomically publish ledger with snapshot, preserving it in source checkpoints. Derive cached summary day/age at render time. Health reports durable counts.
- [ ] Run full backend suite; expect all passing. Commit task.

### Task 2: Show partial daily counts and deploy
**Files:** frontend/src/components/MovementSummary.tsx and .test.tsx, frontend/e2e/cloud-pages.spec.ts, README.md.
**Interfaces:** Existing MovementCounts and onDemand prop; no contract changes.
- [ ] Add failing cloud component tests for saved counts, paused/unavailable/midnight states. Run frontend suite; expect cloud counts hidden failures.
- [ ] Reuse existing panel; add “Detected today · partial coverage” and collection-only-while-viewing explanation; update Pages browser fixture/assertions and README.
- [ ] Run backend/frontend suites, Pages build, cloud Pages/Cesium browser test and diff check; expect all passing. Commit task.
- [ ] Fresh independent branch review, fix important issues with regression tests. Create PR closing #1, deploy allowlisted backend, automatically merge after verification, wait Pages and check live counts/3D. Record results.

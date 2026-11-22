# Cloud daily movement counters

User approved implementing the previously described tasks, creating an issue and branch, and automatically merging after checks (issue #1).

Restore detected daily landings/takeoffs on the existing free Vercel + Upstash backend and GitHub Pages frontend. Cesium remains unchanged; the Mac stays disabled. Counts accumulate only while someone views the tracker. They survive browser closure and cloud instances, roll over at Singapore midnight, and show partial coverage and monitoring gaps. No official-total claim or backfill.

## Approaches
The preceding discussion compared persisting viewing-only counts in the existing cache with a separate background collector. The user requested the five tasks for the first approach. No new account, dependency, scheduler or paid service is needed.

## Implementation choices
Reuse the conservative movement detector and SQLite ledger in memory per request. Export minimal event identity/type/time/day, daily coverage and continuity timestamps to JSON inside the existing shared Redis state. Restore before polling. The existing lease and fenced atomic publish commit counters with the snapshot; provider checkpoints preserve the previous ledger. Cache-only reads never increment totals. Keep seven Singapore calendar days and the existing 120-second duplicate suppression. Serving a cached snapshot after midnight returns a current-day empty summary, never yesterday’s totals. Missing ledger in the old deployed format initializes on upgrade; malformed saved ledger fails closed without resetting counts.

Coverage continuity is restored between serverless invocations, but only successful samples at most 20 seconds apart count as monitored time. Longer gaps remain unmonitored. The UI reuses the existing counts panel, with cloud-specific partial-coverage and while-viewing copy. No new layout.

## Acceptance
Persistence, duplicate refresh/viewer safety, expired leases, failed publication recovery, midnight boundaries, downtime, failed sources, seven-day retention and frontend unavailable/paused states are verified. Backend/frontend suites, Pages build and Cesium browser check pass before review/merge. Deploy backend first (old UI remains compatible), merge through a PR that closes #1, wait for Pages, and verify live summary and Mac independence.

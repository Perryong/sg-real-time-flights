# Free Vercel backend implementation plan

Goal: shared on-demand flight data on Vercel Hobby + Upstash Free; GitHub Pages and Cesium remain, no Mac required.
Authorization: user explicitly requested shared caching, request limits, cutover, and free-only operation. The earlier design/test was accepted; implement inline.

Architecture: a dedicated FastAPI HTTP snapshot endpoint uses an atomic Redis lease to refresh one shared state. Browser polls every 15 seconds while visible. ADSB.fi refreshes at most every 15 seconds, FlyItaly every 30 seconds across all viewers. Redis holds provider retry state and short track history; timestamps are never renewed on cache hits. OpenSky stays disabled. Missing shared storage fails closed. No continuous worker or paid upgrade.

## Tasks
- [x] 1. Create free Upstash resource (Singapore, autoUpgrade=false, prodPack=false), privately configure Redis credentials. Pending user acceptance of marketplace terms.
- [x] 2. Add backend/app/cloud_cache.py + cloud.py, deploy/vercel configuration, allowlisted package exporter. Tests: concurrent callers refresh once, expired lease cannot publish, provider backoff survives instances, all-source failure, stale positions, request limits, unavailable cache and CORS. Real Redis Lua integration checks.
- [x] 3. Add optional HTTP transport to frontend hosting/useTraffic and Pages workflow. Tests: snapshots validate, repeated cache hits do not rewind time, new epoch accepted, no overlapping polling, 429/503 backoff, hidden tabs pause, teardown cancels. Label on-demand mode and unavailable daily counts honestly.
- [x] 4. Run backend/frontend suites, both builds, browser checks; fresh independent review. Deploy on Hobby and prove shared state + source request bounds using concurrent requests.
- [ ] 5. Set GitHub LIVE_BACKEND_URL and LIVE_TRANSPORT, push main and wait Pages success. Verify Cesium 3D + live flights on published site. Stop Mac collector/tunnel after cutover and verify hosted endpoint again.

Free constraints: Vercel Hobby + Upstash Free only; no auto-upgrade, paid daemon, cron, or third-party subscription. Quota exhaustion must show temporary unavailability, never start uncoordinated upstream requests. Personal usage can exhaust free quotas; no promise of unlimited traffic.

Implementation rulings: use short HTTP requests instead of open WebSockets to reduce provisioned-memory time; shared cache stores compressed state. Local backend retains WebSockets. Daily movement counts are unavailable in cloud viewing-only mode rather than being presented as full-day counts.

Review focus: lease ownership, upstream deadlines persisted before network request, cross-instance/IP rate limiting, stale source timestamps and browser clock, credentials excluded from artifacts.

## Execution and review record
- Provisioned `changi-flight-cache` on Upstash Free in Singapore after user accepted terms. Explicit `autoUpgrade=false`, `prodPack=false`; live inspect reports Free.
- Backend tests use real disposable Redis, not a simulated lock. Shared claims, expired-owner fencing, per-viewer/global limits, cache failure, both-source failure, persisted retry deadlines, stale timestamps and HTTP error/CORS paths pass.
- Review fixes: check viewer budget before global budget; checkpoint source reservations before I/O and outcomes on completion; preserve HTTP Retry-After across visibility changes; separate response clock from collection time; derive displayed health from transport and age; document cache-version recovery and include deployment files in source archive.
- Ruling: shared cached reads include only the snapshot, while refresh owners receive provider state as well, to reduce Redis transfer.
- Vercel live verification: 54 aircraft, both sources healthy; three concurrent reads reused epoch/sequence and unchanged provider request counts. CDN returned HIT for all three. Pages origin CORS and response-time header were present.
- Initial full browser run found the local test server stopped (connection refused). Started the test server and reran the suite; this was test setup, not an app failure.

- Final local verification: 137 backend tests, 51 frontend tests, 15 existing browser tests and the HTTP Pages/Cesium test passed; local and Pages builds passed. Deployment dpl_G46wFfSTM48XqgTuD5ujjqSUzcbh is READY.

# Vercel compatibility spike

This is a bounded, disposable test of the existing flight providers and Python
WebSocket protocol on Vercel Hobby. It is **not the production backend**.
The GitHub Pages frontend and the Mac collector are not changed by this experiment.

Project: `perrymikes-projects/sg-changi-feed-test`.
Endpoint: <https://sg-changi-feed-test.vercel.app/api/health>.
Runtime region: Singapore (`sin1`). Function timeout: 60 seconds.

- `/api/aircraft` probes the two enabled sources and returns the existing snapshot contract.
- `/ws/aircraft` polls only during a test connection, then closes after 45 seconds
  with code 1012 so the client can exercise reconnection.
- ADSB.fi uses its existing 10-second interval; FlyItalyADSB uses 30 seconds.
- OpenSky is disabled. No credential or permission changes are made for OpenSky.
- FlyItaly's key is a sensitive Vercel production environment variable, never a
  source file or browser value.
- Daily movement totals are omitted because this test has no durable monitoring.

## Reproduce

Run `.venv/bin/python experiments/vercel-feed/check.py` from the repository root.
It uses synthetic provider results and makes no external requests.

Run `.venv/bin/python experiments/vercel-feed/package.py` to create a temporary
deployment folder containing an explicit allowlist of public source. Link that
folder with `vercel link --project sg-changi-feed-test --yes`. Configure the
FlyItaly key using `vercel env add FLYITALYADSB_API_KEY production --sensitive`
through private stdin. Inspect `vercel deploy --dry --json` before uploading.
Only this temporary folder is deployed, never the repository's `.env`, private
runtime database, credentials, attachments, or workstation logs.

## Before production migration

This spike intentionally creates independent collectors for test requests. It
does not enforce provider limits across multiple Vercel instances or viewers.
Do not point the public tracker at it or leave an automatic reconnect loop running.

The on-demand production backend needs a shared cache and distributed refresh
coordination, persistent provider retry deadlines, and a durable store if daily
movement reporting is retained. Verify frontend reconnection across function
expiry and changing epochs, and measure memory/CPU/transfer usage against the
remaining Hobby quota. Provider positions must keep their original timestamps.
Only switch `LIVE_BACKEND_URL` after those checks pass.

Platform references checked 22 November 2026:
- <https://vercel.com/docs/frameworks/backend/fastapi>
- <https://vercel.com/docs/functions/websockets>
- <https://vercel.com/docs/daemons/limits>

## Verified deployment

Deployment `dpl_Dz4st6TEr2Y9wMdmCCWqWcUPoREJ` built successfully on Hobby.
The public health endpoint returned HTTP 200. The snapshot endpoint returned 63
aircraft, both sources healthy, and the correct GitHub Pages CORS origin.
The WebSocket test received eight schema-validated frames (up to 64 aircraft),
closed with code 1012 after about 55.5 seconds including connection startup, and
successfully reconnected to a new session that returned aircraft. These are
point-in-time observations, not current totals or a coverage guarantee.

The local synthetic smoke check passed. Production frontend browser reconnection,
multi-viewer quota coordination, durable counts, and monthly resource consumption
have not been validated. No paid plan, daemon, or scheduled job was enabled.

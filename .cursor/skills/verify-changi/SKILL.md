---
name: verify-changi
description: Verify Changi Observatory features against synthetic aircraft and the built Pages client. Use for changes to tracker behavior, the client or data contracts.
---

Use the Node version in .nvmrc and Python 3.13. From the repository root, activate the project virtualenv, install backend/requirements.lock and run `npm --prefix frontend ci`. Install redis-server and redis-cli for the cloud integration suite. In frontend, run `npx playwright install chromium` (on Linux CI use `--with-deps`).

Run `sh scripts/verify-feature.sh`. The browser test starts and tears down its own preview on port 4187. Use a free port 4187 and one checkout per concurrent build. The command checks backend behavior, fixtures, geometry, frontend tests, types, the Pages bundle and the offline browser journey.

| User action | Observable outcome | Existing check |
|---|---|---|
| Open the offline Pages site, switch to 3D and select SYN 101 | 16 synthetic flights, visibly labelled demo, Cesium canvas, details for the selection and no live socket | frontend/e2e/pages.spec.ts |
| Open Live during a feed outage, then explicitly choose Demo | Live stays empty until the user chooses the synthetic scenario | frontend/e2e/tracker.spec.ts |
| Inspect the daily movement counts on a hosted HTTP snapshot | Mocked feed displays today's counts and partial coverage | frontend/e2e/cloud-pages.spec.ts |

For a changed journey, exercise it directly in addition to the common check. The local tracker suite needs the backend and Vite dev server running as in the README. The hosted HTTP spec needs a separate Pages build with its mocked backend URL and HTTP transport. See the spec for the exact URL. Keep provider credentials and production feeds out of verification.

Report the command, commit, observed outcome and any blocked checks. For a fix, show the check failing on the original behavior and passing on the patch. Playwright failure traces are in frontend/test-results.

# Provider gate — 19 November 2026

The official https://airplanes.live/api-docs/ and https://airplanes.live/api-guide/ returned HTTP 403/access challenge through browsing and direct HTTP. No continuous API polling or coverage sampling has been performed. Endpoint, authorization, display/retention permissions, rate policy and timestamp units remain unverified. This is not proof that a properly authorized deployment cannot access the provider.

The adapter is implemented against synthetic `ac`/`now` contract fixtures; these are assumptions until verified. `AIRPLANES_NOW_UNITS` explicitly configures seconds or milliseconds. Credentials remain in the backend. The default requires both LIVE_ENABLED and AIRPLANES_ACCESS_VERIFIED to be explicitly enabled after verification. No provider substitution or automatic demo fallback.

Mock transport tests cover empty/partial responses, schema errors, timeout, 401/403 pause, numeric/date 429 Retry-After and 5xx. Store/API tests cover original timestamps, late/duplicate records, capacity, discontinuities, origin rejection and bounded shared delivery. Live release AC-02 and coverage/classification validation remain blocked.

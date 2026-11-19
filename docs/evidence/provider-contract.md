# Provider gate — 19 November 2026

The official https://airplanes.live/api-docs/ and https://airplanes.live/api-guide/ returned HTTP 403/access challenge through browsing and direct HTTP. No continuous API polling or coverage sampling has been performed. Endpoint, authorization, display/retention permissions, rate policy and timestamp units remain unverified. This is not proof that a properly authorized deployment cannot access the provider.

The adapter is implemented against synthetic `ac`/`now` contract fixtures; these are assumptions until verified. `AIRPLANES_NOW_UNITS` explicitly configures seconds or milliseconds. Credentials remain in the backend. The default requires both LIVE_ENABLED and AIRPLANES_ACCESS_VERIFIED to be explicitly enabled after verification. No provider substitution or automatic demo fallback.

Mock transport tests cover empty/partial responses, schema errors, timeout, 401/403 pause, numeric/date 429 Retry-After and 5xx. Store/API tests cover original timestamps, late/duplicate records, capacity, discontinuities, origin rejection and bounded shared delivery. Live release AC-02 and coverage/classification validation remain blocked.

A final official-document check again returned 403 for both pages. Search indexing exposes an API overview but does not establish current geographic endpoint access, units or reuse permissions; it is not sufficient to enable polling. Third-party claims about access restrictions were not treated as provider authorization evidence.

## Direct access checks — 19 November 2026, 17:28–17:30 SGT

One unauthenticated request to the configured Airplanes.live Changi endpoint returned **HTTP 403 with a JSON error**, not a Cloudflare HTML challenge. The provider asks the project owner to contact contact@airplanes.live with project details. This distinguishes an actual API access refusal from the earlier documentation-fetch failures. No ongoing polling was enabled and no aircraft response was retained. The user confirmed they do not currently have provider access.

A separate one-request evaluation of the documented ADSB.fi public geographic endpoint returned **HTTP 200 and 13 positioned aircraft** within 25 NM of Changi at approximately 17:30 SGT. Response `now=1795087800002` was milliseconds; converting to seconds places it about 1.8 seconds before receipt. Only field names, counts and response timing were examined; no aircraft records were saved. This is evidence of one successful query, not sustained coverage or classification accuracy.

ADSB.fi has not been integrated or enabled. A provider change and the personal/non-commercial use restriction are pending the user's decision. See [the concrete proposal](../superpowers/specs/2026-11-19-live-provider-proposal.md).

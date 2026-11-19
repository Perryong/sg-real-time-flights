# Provider evidence — 19 November 2026

## ADSB.fi selected and enabled for personal use

The user approved ADSB.fi and retaining Cesium. The fixed public v3 Changi endpoint returned HTTP 200 with six positioned aircraft on the integration check at approximately 23:33 SGT. `now=1795102428002` divided by 1000 was about 0.25 seconds before receipt. The adapter explicitly converts milliseconds; it does not infer units by magnitude. `seen_pos` and `seen` follow the compatible ADS-B schema age-in-seconds convention. Missing, wrong-unit and future times cannot become fresh observations.

References: [ADSB.fi endpoint, limits and personal-use terms](https://github.com/adsbfi/opendata), [compatible field semantics](https://www.adsbexchange.com/version-2-api/). The compatible documentation describes a seconds-based `now`; the actual ADSB.fi v3 response above is milliseconds, so the adapter has a provider-specific conversion.

The local `.env` enables the single ten-second poller, with explicit personal-use acknowledgement. Distributed configuration remains disabled. ADSB.fi credit and a homepage link appear in the viewer. No WorldMonitor code was copied. No raw live response is retained in source, fixtures or the distribution. Changi ground coverage and flight-phase accuracy are not established by these checks.

## Historical Airplanes.live investigation (superseded)

The official https://airplanes.live/api-docs/ and https://airplanes.live/api-guide/ returned HTTP 403/access challenge through browsing and direct HTTP. No continuous API polling or coverage sampling has been performed. Endpoint, authorization, display/retention permissions, rate policy and timestamp units remain unverified. This is not proof that a properly authorized deployment cannot access the provider.

The adapter is implemented against synthetic `ac`/`now` contract fixtures; these are assumptions until verified. `AIRPLANES_NOW_UNITS` explicitly configures seconds or milliseconds. Credentials remain in the backend. The default requires both LIVE_ENABLED and AIRPLANES_ACCESS_VERIFIED to be explicitly enabled after verification. No provider substitution or automatic demo fallback.

Mock transport tests cover empty/partial responses, schema errors, timeout, 401/403 pause, numeric/date 429 Retry-After and 5xx. Store/API tests cover original timestamps, late/duplicate records, capacity, discontinuities, origin rejection and bounded shared delivery. Live release AC-02 and coverage/classification validation remain blocked.

A final official-document check again returned 403 for both pages. Search indexing exposes an API overview but does not establish current geographic endpoint access, units or reuse permissions; it is not sufficient to enable polling. Third-party claims about access restrictions were not treated as provider authorization evidence.

## Direct access checks — 19 November 2026, 17:28–17:30 SGT

One unauthenticated request to the configured Airplanes.live Changi endpoint returned **HTTP 403 with a JSON error**, not a Cloudflare HTML challenge. The provider asks the project owner to contact contact@airplanes.live with project details. This distinguishes an actual API access refusal from the earlier documentation-fetch failures. No ongoing polling was enabled and no aircraft response was retained. The user confirmed they do not currently have provider access.

A separate one-request evaluation of the documented ADSB.fi public geographic endpoint returned **HTTP 200 and 13 positioned aircraft** within 25 NM of Changi at approximately 17:30 SGT. Response `now=1795087800002` was milliseconds; converting to seconds places it about 1.8 seconds before receipt. Only field names, counts and response timing were examined; no aircraft records were saved. This is evidence of one successful query, not sustained coverage or classification accuracy.

At the time of this earlier check, ADSB.fi was not integrated or enabled; that decision is superseded by the approval above. See [the concrete proposal](../superpowers/specs/2026-11-19-live-provider-proposal.md).

# Geometry evidence — 19 November 2026

CAAS WSSS AD 2 was inspected and the AIP index points to an October 2026 edition. Its redistribution terms are restrictive; this build does not redistribute CAAS charts or certify authoritative import accuracy. The <=2m/5m/0.1-degree authoritative acceptance gate is NOT passed.

Runnable visualization uses Unlicense OurAirports WSSS runway records and ODbL OpenStreetMap taxiway/terminal footprints retrieved from API 0.6. Original object IDs and checksums are in the manifest. All three physical runway pairs are included. OurAirports displaced-threshold distance for 20R is converted from feet and applied geodesically without shortening pavement. Community endpoint precision differs from survey accuracy; length consistency check allows 30m and a 0.25-degree check against the community integer bearing, disclosed in tests, and does not replace the authoritative gate.

Airport geometry is drawn above an ellipsoid fallback. Building heights are sourced when available, otherwise estimated at 18m and labeled. Aircraft barometric and geometric heights are preserved separately; no unverified geoid correction is claimed. Visual ground clamp is display-only. Operational runway status remains unknown. Lighting is illustrative.

`python scripts/verify_airport.py` checks distributed-file hashes and reports derived geodesic lengths/bearings. Browser inspection is recorded separately after the viewer is implemented.

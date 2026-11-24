# Regional weather coverage proposal

Status: approved. User instructed: ‘Proceed with the implementation.’ Recommended regional model-wind approach selected.

## Requested outcome

Expand wind and rain coverage to match the Singapore aircraft map, whose configured radius is 500 km. Retain Cesium 3D, the existing weather toggles, free personal-use providers, and the GitHub Pages / Vercel / shared Redis deployment.

## Approaches

1. Recommended: NEA's observed 480 km rain radar plus Open-Meteo modelled surface wind across a 500 km radius. This gives broad regional weather with an explicit model label for wind.
2. Observations only: expand rain radar to 480 km and retain Singapore wind-station observations. This cannot provide wind across the aircraft map.

Stretching the existing 70 km radar image or copying Singapore station winds over the region is not a valid approach. NEA offers 70, 240 and 480 km products; a 480 km image does not establish rain coverage throughout a 500 km circle.

## Proposed behavior

- Rain radar uses the official 480 km product and its actual geographic bounds. Label it “Rain radar · 480 km.” Preserve timestamps, opacity, expiry handling and source attribution. Areas outside supplied radar coverage have no rain observations.
- The existing Wind toggle displays a fixed, bounded grid of modelled 10 m surface winds across the 500 km aircraft area. Label it “Regional wind · modelled · 10 m” and display the valid time and Open-Meteo attribution. These are model estimates, not aircraft-altitude winds or measured stations.
- Keep the existing station endpoint available for compatibility with already-open older frontend versions. New regional responses have an explicit distinct type; never present model points as reporting stations.
- Choose sample spacing and arrow length appropriate to the regional map. Keep reduced-motion support, non-pickable arrows, cleanup on disable, and aircraft/pin/follow controls intact.
- Cache regional wind for 15 minutes across viewers. Use at most 81 fixed points per refresh, counting each coordinate conservatively toward provider limits. At 96 refreshes/day, 81 locations would be 7,776 location calls/day, below Open-Meteo's 10,000/day free limit; fewer points inside the circle reduce this. No user-supplied upstream coordinates or arbitrary proxy URLs.
- Keep weather's existing Redis monthly allowance, request limits, leases, denial handling and hidden-tab pause. Version the expanded radar cache so an old 70 km cached frame cannot be mislabeled as 480 km. No paid infrastructure.

## Verified sources

- Aircraft coverage: frontend/src/data/regions.ts, Singapore radius 500 km.
- https://data.gov.sg/datasets/d_418e9ac3414fd927b7405631e0a7bc82/view
- https://api-open.data.gov.sg/v2/real-time/api/weather-radar-images/480km
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/terms
- https://open-meteo.com/en/pricing

Read-only API probes on 25 November 2026 (SGT) returned HTTP200 for NEA's 480 km feed and an Open-Meteo multi-location current-wind query. Radar bounds: west99.638609, east108.290871, south-2.967382, north5.657912. The source projection is local azimuthal equidistant; geographic image placement must account for the wider-area projection rather than silently assuming a precise equirectangular image. Open-Meteo current winds are based on 15-minute model data and return m/s and meteorological direction when requested. No API keys were needed for these probes.

## Implementation and verification after the choice

Validate wider radar bounds/range, model response units, coordinates, timestamps, missing values, and quota behavior. Test cache migration and old/new frontend compatibility. Verify real 480 km imagery and wind rendering on desktop/mobile, including coverage-edge placement, follow view, pins, stale/error states and reduced motion. Run backend/frontend suites and Pages build. Use the established branch, review, merge and deployment workflow, followed by checks on the published site.

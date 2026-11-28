# Regional wind and the Changi Airport outlook

**Status** — Proposed for approval, 28 November 2026. Covers the remaining weather items in [issue #12](https://github.com/Perryong/sg-real-time-flights/issues/12).

## What the user sees

In the Singapore Live view, **Wind** answers “Which way is the surface wind flowing across the region?” **Changi outlook** answers “What conditions should I expect at the airport?” The user selected a fixed Changi Airport outlook. Panning, moving the observer pin, or selecting an aircraft leaves its forecast location at 1.3644° N, 103.9915° E. Wind, radar and the outlook can be used independently.

### Wind

- The existing Wind button toggles a translucent regional speed layer. Short trails move downwind. A wind reported from the northeast flows southwest. With reduced motion, stationary arrowheads show the same direction. Calm areas show the lowest speed color with no directional motion.
- Label the layer **Regional surface wind · 10 m**. Use a sequential low-to-high color scale with labelled stops at 0, 2, 5 and 10 m/s and an open-ended 10+ top band. Show the model valid time in SGT and credit Open-Meteo. Color communicates speed, while the trails communicate direction.
- Keep the current 500 km region, 49 requested samples, approximately 125 km spacing, and 15-minute shared refresh. Animate the latest valid field. The five forecast days belong to the airport outlook. Zooming in magnifies the same regional estimate.
- Convert meteorological bearings into east/north velocity components before interpolating, so neighboring 359° and 1° winds agree. Preserve the grid topology using the existing sample IDs. Fill only cells with four valid, same-time corners, using their actual model coordinates. Clip at the region boundary. Leave unsupported cells transparent. Where an isolated valid sample has no supported cell, show its existing point glyph. Calm and missing data remain distinguishable.
- Leave aircraft labels, tracks, selection and radar legible. Draw the speed shading beneath radar, use a lighter wind treatment when radar is on, and let map input pass through the weather graphics. During historical radar playback, explicitly label wind with its own valid time.

### Changi outlook

Open **Changi outlook** from the existing weather controls. On desktop it opens a compact card. On mobile it opens a dismissible sheet with five stacked rows. Opening the outlook requires no map gesture or active overlay. Closing it restores focus to its button.

| Section | Content |
| --- | --- |
| Heading | Changi Airport, Singapore. Show Open-Meteo as the source and identify conditions as modelled. |
| Current conditions | Relative humidity at 2 m in %, mean sea-level pressure in hPa, and the model valid time in SGT. Round both readings to whole units. |
| Next five days | One row per Singapore calendar day starting tomorrow. Each has weekday and date, a plain-language weather condition, and labelled low and high in °C. Show the last successful forecast retrieval time in SGT. |
| Partial data | Display “Unavailable” for a missing value or condition. Keep its date and all valid neighbors or fields. Preserve valid zero values, including weather code 0 (clear sky). |
| Offline or stale | Show clearly dated cached values within the limits below. When none are usable, leave the card available with an unavailable state. Wind and radar keep their own status. |

## Data and delivery

The current client reads a shared regional wind response and renders arrows at individual samples. The regional request asks only for current 10 m wind speed and direction. Keep that contract and the radar endpoints. Implement flow in the existing Cesium scene; the renderer, particle count and drawing technique are builder decisions. Bound visible trails, stop animation on hidden tabs, and dispose resources when Wind or the view is disabled.

Add an independent fixed airport layer through the existing weather API, for example `/api/weather?layer=changi_outlook`. Use the same backend URL allowlist, shared cache/lease and failure backoff as existing weather layers. Only request the outlook while open and eligible. Limit upstream refreshes to once per 15 minutes across viewers. Keep Singapore Live mode eligibility and explain it in Demo, Recorded or another region. Keep provider credentials scoped to their current providers.

One Open-Meteo request uses the fixed airport coordinates, `timezone=Asia/Singapore`, `current=relative_humidity_2m,pressure_msl`, `daily=weather_code,temperature_2m_min,temperature_2m_max`, and `forecast_days=6`. This gives today plus the requested five dates. Preserve the daily dates as Singapore-local calendar dates. Join data by date and select tomorrow through day five using the actual Singapore date, including after midnight while the card stays open. A missing new fifth day stays visible as unavailable until refreshed. A six-date response with these fields and units was verified during discovery. [Open-Meteo API](https://open-meteo.com/en/docs)

Expose fixed location, source, retrieval time, current valid time and individually nullable fields, plus forecast records keyed by date. Validate units, ranges and array indices per field; never shift another date’s data into a gap. Handle unknown weather codes and missing or inverted temperature ranges explicitly. A partial response should survive parsing on both server and client.

**Proposed freshness rules.** For current readings, show the valid time, mark values over 30 minutes old as stale, and omit values over one hour old. For daily rows, use retrieval age, mark forecasts over one hour old as stale, and omit cached values over six hours old. Use the existing regional wind validity limit independently. An upstream error does not refresh the timestamp on an older successful response.

## Approaches considered

The selected approach reuses the regional Open-Meteo wind grid and adds one shared Changi point forecast. It supports regional flow while making the airport location and forecast dates unambiguous. The [Zoom Earth reference](https://zoom.earth/maps/wind-speed/#view=1.391,103.985,6z/model=icon) informs the visual treatment. Its imagery, tiles, forecast timeline and specific ICON model are outside this release.

Keeping only larger sample arrows would preserve exact sample positions but make paths between points hard to follow. A forecast at each map click would help someone exploring Johor or Batam, but it changes the meaning of the card and requires location-dependent queries. Location selection can be considered separately.

## Approval checks for the implementation

1. With a known northeasterly wind, Playwright shows southwestward flow on the map; reduced-motion mode shows southwest-facing static arrows. Verify the north wraparound, calm cells, missing corners and clipping with deterministic fixtures.
2. Capture desktop and mobile examples of wind with aircraft and radar visible. Pan, zoom, toggle wind, and pick an aircraft. Compare frame timing with wind off/on at the same viewport and traffic load; repeated toggles must release the old animation and scene resources.
3. Open the outlook with Wind off. Verify the fixed Changi label, independent valid/fetched times, units, and five consecutive dated rows. Pan or select another aircraft and verify the location stays fixed.
4. Test the SGT midnight and month boundary, zero humidity, clear-sky code zero, one missing date, a missing pressure value, stale data and a failed refresh. Valid fields stay readable in each case.
5. With concurrent viewers, opening the outlook shares one upstream refresh. Verify that closing it stops client polling, and that Demo or a different region does not fetch Singapore weather. Browser tests use recorded or synthetic fixtures; deployment verification checks the public application separately.

Implementation and deployment require a later go-ahead. This document proposes the design only.

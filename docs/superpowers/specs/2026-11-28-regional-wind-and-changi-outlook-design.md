# Regional wind and the Changi Airport outlook

Approved and shipped on 28 November 2026. This record covers the weather portion of [issue #12](https://github.com/Perryong/sg-real-time-flights/issues/12) as implemented in [PR #19](https://github.com/Perryong/sg-real-time-flights/pull/19).

## What the user sees

In Singapore Live mode, **Wind** shows how the surface wind flows across the region. **Changi outlook** shows modelled weather at Changi Airport, fixed at 1.3644° N, 103.9915° E. Panning, moving the observer pin, or selecting an aircraft leaves the forecast at Changi. Wind, rain radar and the outlook can each be opened independently.

### Wind

- **Regional surface wind · 10 m** uses a translucent speed scale labelled 0, 2, 5 and 10+ m/s. Short trails move downwind. A wind from the northeast flows southwest. Reduced-motion mode shows stationary arrows. The legend credits Open-Meteo and shows the model valid time in SGT.
- The regional request asks for current 10 m wind speed and direction at 49 locations about 125 km apart. The server keeps usable samples from the latest valid time in the response. Zooming in magnifies the same 500 km regional estimate. The map hides wind once its model valid time is more than 30 minutes old.
- The renderer uses the grid IDs to find four neighboring samples. It interpolates eastward and northward velocity across their returned model coordinates, so winds reported from 359° and 1° agree near north. Shading and trail paths stay within supported cells and the 500 km radius. Calm cells have the lowest speed color and no directional motion. Missing cells stay transparent. An isolated sample appears at its reported location as an arrow or calm ring. Its symbol can extend past the shaded boundary.
- Cesium draws a 256 × 256 speed image beneath radar and batches the trail geometry. Wind becomes fainter when radar is visible. The trails ignore map picks, pause animation in hidden tabs and release their scene resources when the layer is removed. During historical rain playback, wind keeps updating and shows its own valid time. [Wind renderer shipped in #19](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/frontend/src/scene/weather.ts)

### Changi outlook

In #19, **Changi outlook** opens a desktop card or a modal sheet at viewport widths of 800 px or less. Opening the outlook requires no map gesture or active overlay. The close control and Escape dismiss it and return focus to the outlook button.

| Section | Shipped behavior |
| --- | --- |
| Heading | Changi Airport, Singapore, with Open-Meteo credited as the source of modelled weather. |
| Current conditions | Relative humidity at 2 m in percent and mean sea-level pressure in hPa, rounded to whole units. The model valid time is shown in SGT. |
| Next five days | Five Singapore calendar dates starting tomorrow. Each row shows the weekday, date, weather condition and low and high temperatures in °C. The forecast shows the last successful retrieval time in SGT. |
| Partial data | An unavailable field keeps its place. A valid zero survives, including 0% humidity and weather code 0 for clear sky. An unknown weather code affects the condition alone. An inverted low and high invalidates both temperatures. |
| Failed refresh | The card shows a status message and keeps usable cached fields with their original timestamps. Expired or missing fields display **Unavailable**. |

## Data and delivery

The API release must support the new layer before the Pages client is published. The Pages client requests `GET /api/weather?layer=changi_outlook` from the separately deployed weather API. The client polls while the outlook is open in a visible Singapore Live tab. Closing the card stops polling. Redis shares the upstream refresh across viewers on a 15-minute interval. If another viewer opens the card while the first request is fetching and the cache is empty, the API returns HTTP 202. The client checks again after 15 seconds. Provider failures use the shared backoff. The data.gov.sg credential stays with its provider. [Weather service shipped in #19](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/backend/app/weather.py)

One Open-Meteo request uses the airport coordinates, `timezone=Asia/Singapore`, `current=relative_humidity_2m,pressure_msl`, `daily=weather_code,temperature_2m_min,temperature_2m_max` and `forecast_days=6`. The response covers today plus five dates. The backend validates units and ranges per field and reads each value at its original date index. The API returns a `daily` array with a `date` on each record. At Singapore midnight the card advances the five displayed dates. A newly visible date stays unavailable until the next successful retrieval supplies it.

Current readings use the model valid time, `observed_at`. They become stale after 30 minutes and expire after one hour. Forecast rows use the retrieval time, `fetched_at`. They become stale after one hour and expire after six hours. A failed refresh leaves the last successful timestamps intact. [Freshness and date rules](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/frontend/src/data/weather.ts)

## Design choices

Interpolating the existing grid shows flow between samples while preserving gaps in coverage. A single airport forecast gives every viewer the same location, dates and shared cache. The Zoom Earth reference informed the wind treatment. Open-Meteo supplies the model data and Cesium draws the layer. [Wind design reference](https://zoom.earth/maps/wind-speed/#view=1.391,103.985,6z/model=icon)

## Verification and subsequent changes

The wind fixtures cover north wraparound, calm and missing samples, and clipping. Renderer tests cover reduced motion and cleanup. Playwright checks in #19 cover desktop and mobile outlooks, Singapore midnight across a month boundary, missing and zero values, and aircraft selection with the desktop card open. The release PR records captured southwestward flow for a northeasterly wind and a wind-off/on frame timing comparison in Chromium software rendering. [Wind fixtures](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/frontend/src/scene/windField.test.ts) · [Outlook and shared-cache tests](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/backend/tests/test_changi_outlook.py) · [Browser checks](https://github.com/Perryong/sg-real-time-flights/blob/685bccd8ba26a6c347f300b540d3a791acdfd8e6/frontend/e2e/weather-pages.spec.ts) · [Release evidence and screenshots](https://github.com/Perryong/sg-real-time-flights/pull/19) · [Pages build and deployment](https://github.com/Perryong/sg-real-time-flights/actions/runs/46135190184)

- Wheel scrolling gained access to the last forecast row in a short desktop window with aircraft details open. [PR #20](https://github.com/Perryong/sg-real-time-flights/pull/20)
- Unsupported wind edges gained a fade, and a circular mask trimmed the live and historical radar images. [PR #21](https://github.com/Perryong/sg-real-time-flights/pull/21)
- Traffic and Weather gained a shared drawer on compact screens. Outlook dismissal now restores focus immediately so the next keyboard action reaches its intended control. [PR #23](https://github.com/Perryong/sg-real-time-flights/pull/23)

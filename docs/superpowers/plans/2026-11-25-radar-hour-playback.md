# One-hour rain radar playback implementation plan

User approved: “Proceed the one hour rain radar playback next.” Implement the offered Play/Pause, time slider and Return to Live. Existing authorization covers branch, review, commit, push, merge and publish.

Architecture: add fixed layer=radar_history to the existing weather endpoint/cache. New UI enters history only on demand. Latest aircraft and wind continue independently. Cesium maintains a bounded13-frame provider cache and at most one displayed radar layer; delayed loads must never show a false frame timestamp.

## Contracts

History response extends WeatherEnvelope: `{layer:'radar_history',range_km:480,window_start:number,window_end:number,frames:RadarFrame[],expected_frames:13}`. Window_end=floor(now/300)*300; start=end-3600, in UTC epoch seconds. Each actual observation must lie in that hour, sorted strictly ascending, unique, maximum13; no copying frames into missing slots. observed_at is newest actual frame or null. State refers to snapshot availability/fetch freshness. Image URL expires_at remains explicit. Failed fetch returns stale cached metadata with safe filtering, never manufactured rain. Shared snapshot interval300s, hard snapshot age900s, imageexpiry honored. Current live-radar layers remain unchanged.

Backend fetches fixed NEA480km endpoint with date=SGTcalendar day, returning25 newest records in real probe (49KB); at SGT midnight fetch prior day too when needed. At most2 provider requests per refresh; no arbitrary dates passed by clients, no unbounded pagination or per-frame requests. Filter normalized frames within window; sort/dedupe/limit13; keep partial availability explicit. Validate projection/bounds/range/PNG host/times. Existing monthly weather allowance, rate limits, crash reservation and provider denial apply. No paid service/background collector.

Frontend adds HistoryWeather to WeatherData. History freshness uses fetched_at/window bounds and at least one nonexpired frame, not the15-minute live observation rule. Helpers return currently usable actual frames; expired links must not appear in slider/playback. Poll only while replay active and radar enabled in Singapore Live mode; stop replay on region/mode/off, pause on hidden tab, no autoplay on entry/reduced motion. During replay retain live radar polling so Return to Live has current data. One additional request/5minutes only while history open.

UI: “Past hour” enters paused replay and selects oldest available frame. Play advances through available frames at2seconds per successfully displayed frame and loops. Slider index picks actual frame, pauses. Show SGT observation time and “Historical rain · Aircraft remain live” prominently on map, including follow/mobile where details can be collapsed. Return to Live always reachable. Show available/13 frame count, missing-frame note, loading/error/expiry states. Do not interpret unavailable history as no rain. On new snapshots retain selected timestamp if present, otherwise clamp to nearest available timestamp and pause. Explicit history badge may show selected time only when that frame is displayed; loading must not mislabel an old frame.

Renderer API: `createRadarLayerController(viewer:Viewer)` returns `{show(frame:RadarFrame|null,opacity:number,onReady:(at:number|null)=>void,onError:()=>void):void,destroy():void}`. Maintain one visible layer; keep old while new image loads, call onReady only when switched to requested frame. Error clears visible radar and signals null/error. Null removes layer and invalidates in-flight loads. Cache max13 decoded providers by URL, LRU eviction; generation guards prevent late/out-of-order visibility; no reload for opacity-only changes. Keep existing addRadarLayer helper for existing tests/compatibility. Root owns MapScene wiring.

## Ownership and steps

- Backend worker: backend/app/weather.py and new focused backend tests. TDD history/date midnight/window/duplicate/missing/expired/unsafe URLs; real Redis limit/denial/lease tests; full backend suite. No frontend/docs/git/deploy.
- Renderer worker: frontend/src/scene/weather.ts and tests only. TDD async switching, single-layer, callbacks, stale loads, eviction, opacity and destroy. No MapScene/types edits or browser.
- Root: frontend types/parser/history helpers, playback hook/UI, App/MapScene wiring, CSS, browser tests, docs. TDD timestamps, state transitions, hidden/off/region and stale/error handling. Preserve wind/live-aircraft/pins/follow/mobile controls.
- Final independent review, full suites/build and real browser rendering (desktop/mobile, replay/seek/pause/live, overlay labels, aircraft current). Safe source-only Vercel deploy, verify history/legacy endpoints, commit/push/PR/merge, watch Pages release, public smoke check.

Rulings: day endpoint avoids13 per-frame calls under Vercel30second limit. If a day page has fewer actual observations, show partial history instead of requesting unbounded pages. Playback is explicitly historical rain; it is not a flight replay. Existing approximate geographic placement of480km AEQD imagery remains documented; no invented projection transform.

## Execution record

Backend and renderer tasks completed in isolated file ownership; root integrated the types, state hook, controls and MapScene. Parser/hook/controller tests used red-to-green checks. Independent review identified Pause being disabled while a new image loads; fixed and regression-tested. Review then approved. Real Redis suite passed after making an existing minute-boundary-sensitive test retry only across changed minutes. No production quota was changed.

Verification: 278 backend + 135 frontend tests, Pages build, 3 weather browser tests and 6 follow regressions passed. Production Vercel history returned 13/13 frames; actual desktop/mobile playback and Return to Live rendered with 64 live aircraft and no errors. See docs/radar-playback-verification.md. Proceeding through the previously authorized commit/push/PR/merge/Pages publication workflow.

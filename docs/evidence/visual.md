# Geographic and 3D visual checks

19 November 2026, installed Google Chrome 157.0.8103.79, Apple M5 Pro / ANGLE Metal renderer. No page errors in the installed-browser smoke. Native screenshot artifacts were inspected after capture.

- `overview.png`: 1920×1080 geographic overview, 16 explicitly synthetic aircraft, Singapore/Malaysia/Indonesia context, searchable sidebar, source/age status and credits.
- `runway-02C.png`, `runway-02L.png`, `runway-02R.png`: all three named runway camera controls, labels, community taxiways and extruded terminal masses. Visual alignment is not authoritative surveying or a precision certification.
- `follow-aircraft.png`: selected synthetic aircraft and generic model, follow control, original 2023 scenario timestamp, altitude references and inferred/unknown state.
- `day-map.png`: day presentation with the same scenario clock and explicit simulation label.
- `mobile-map.png`, `mobile-details.png`: 390×844 geographic overview and selected-aircraft sheet, no horizontal overflow.

Cold local scene readiness: 1.253 seconds; warm local reload: 0.433 seconds. These measure locally served bundle/scene readiness, not a guarantee that every remote map tile is loaded or a WAN deployment SLA.

Browser fault tests cover blocked aircraft model, unavailable WebGL, and context loss while following. Runtime scene loss disables follow. Tile/model notices remain distinct from renderer availability. Safari automation was unavailable because the installed browser disallows remote automation; Edge was not installed. Neither is claimed tested.

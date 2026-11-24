# Local aircraft-specific model improvement

Superseded asset approach: the later user request for Polyfork and 3DStreet is implemented as documented in `2026-11-24-realistic-follow-design.md`. The active four GLBs are Polyfork adaptations; the original procedural generator remains as an earlier prototype. The type mapping, dimensions, local-only constraint and validation below still apply.

User selected aircraft-specific A350 and Boeing 777 models and explicitly paused commits and publication. Extend the existing original procedural glTF assets; no paid assets, external model dependencies or airline liveries. Start with reported ICAO types A359 (A350-900), A35K (A350-1000), B77L (777-200LR), B77W (777-300ER). Other types retain a clearly labeled generic fallback.

Use manufacturer length/span proportions and distinct visible features: A350 swept curved winglets and cockpit mask; 777 raked tips and larger engine nacelles. Both get shaped/shaded fuselages, thick wings, nacelle intake/fan/exhaust detail, cockpit/cabin windows and tail surfaces. These are simplified visualizations, not engineering-exact meshes. Render full type names in the flight card. Keep model assets local and model selection automatic; no user-facing configuration is needed.

Verify ICAO mapping, GLB normals/dimensions, fallback behavior, existing follow/observer functionality, and desktop/mobile visual previews of both types. Address the four already-confirmed follow review issues locally. Do not commit, push, merge, or publish; leave the draft PR unchanged while the user reviews the local result.

Sources: https://www.aircraft.airbus.com/en/aircraft/a350/a350-900 ; https://www.airbus.com/en/products-services/commercial-aircraft/passenger-aircraft/a350-family ; https://www.boeing.com/commercial/777 . Dimensions checked November 24, 2026. A359 66.80×64.75m, A35K 73.78×64.75m, B77L 63.7×64.8m, B77W 73.9×64.8m.

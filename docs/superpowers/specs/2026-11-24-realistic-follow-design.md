# Local visual realism pass

User requests the reference-style aircraft-follow view using Perryong/3dstreet and Perryong/polyfork-catalog. No commits or publication. Continue the existing Cesium implementation and all local aircraft-model improvements.

Research found the 2017 EOX layer returns flat placeholder tiles around Changi even with HTTP 200. The 2024 layer provides real satellite imagery and is CC BY-NC-SA 4.0, suitable for this personal non-commercial tracker. Replace the backdrop and its attribution. Images are historical, not live.

Polyfork is an asset catalog, not a renderer. Import its free Widebody Airliner GLB under CC BY 4.0, retaining credit and recording changes. Adapt length/span and wingtip treatment for the existing four reported types; label all as approximate representations. Retract unobserved landing gear, retain detailed engines, windows, flap surfaces and shaded materials. Unknown types still use the generic fallback. Avoid importing Polyfork source modules or HD assets.

3DStreet is an A-Frame/Three.js application with AGPL code, not a drop-in Cesium library. Use its documented CC0 Poly Haven sky asset and its geographic-layer approach without copying its application code or adding a second renderer. A bounded OSM footprint extract was attempted, but public Overpass services failed or timed out. No extra buildings were added. Existing approximate airport geometry is hidden during follow to preserve the satellite image. Flat ellipsoid remains; paid Google/MapTiler services and billing accounts are outside the free scope.

Follow presentation: camera-side daylight with model shading, photographic sky, fewer floating markers, purple observed trail, and a closer trailing composition with adjustable orbit. Keep source timestamps, stale pause and unknown data truthful. Ensure backdrop/building errors preserve navigation. No synthetic location changes to real flights.

Validation: asset origin/license and bounds, satellite imagery and environment cleanup, follow camera and selection, stale/lost regressions, desktop/mobile screenshots, observer regression. Local preview only. Known limits: approximate aircraft models, historical imagery, flat terrain; no live weather claim.

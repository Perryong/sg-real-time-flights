# Aircraft meshes

## Airbus A320-200

`airbus-a320-200.glb` uses [Airbus A320-200 by Airbus5717](https://sketchfab.com/3d-models/airbus-a320-200-7b8910d3cf824e6399c4ca75a31130ed) under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). The mesh is uniformly scaled to 37.57 m and centered nose to tail for aircraft follow mode. The original geometry and materials are preserved.

Run `python3 scripts/import_a320_aircraft.py` from the repository root to rebuild the model. The script downloads the [pinned Objaverse copy](https://huggingface.co/datasets/allenai/objaverse/resolve/556637099bf4fa79ea7b239d0d9c328b8a2e9ac8/glbs/000-113/7b8910d3cf824e6399c4ca75a31130ed.glb) of the Sketchfab GLB and verifies its SHA-256 checksum.

## Airbus A350 and Boeing 777

Widebody Airliner by Polyfork (https://polyfork.dev/asset/widebody-airliner-ae0a5a), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

The four A350/777 GLBs are adaptations of that free mesh: node transforms baked, landing gear omitted, origin centred, length/span changed to approximate each reported variant, raised outer tips for the A350 representation, and material roughness adjusted. These are approximate family representations, not manufacturer-supplied aircraft models. No affiliation with or endorsement by Polyfork, Airbus or Boeing is implied.

The source GLB retains its embedded copyright at data/models/polyfork-widebody-source.glb. Rebuild adaptations with python3 scripts/import_polyfork_aircraft.py. No Polyfork source modules, HD assets or preview images are redistributed.

## Generic aircraft

Generic-aircraft.glb remains the original Changi Observatory procedural model.

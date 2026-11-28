"""The shipped mesh must match Cesium's +Z-forward, Y-up glTF convention."""
import json, struct
from pathlib import Path

def test_aircraft_mesh_has_surface_normals_and_forward_axis():
    blob=Path('frontend/public/models/generic-aircraft.glb').read_bytes()
    length=struct.unpack_from('<I',blob,12)[0]
    model=json.loads(blob[20:20+length])
    for primitive in model['meshes'][0]['primitives']:
        assert 'NORMAL' in primitive['attributes']
        position=model['accessors'][primitive['attributes']['POSITION']]
        normal=model['accessors'][primitive['attributes']['NORMAL']]
        assert normal['count']==position['count']
    fuselage=model['accessors'][0]
    assert fuselage['max'][2]-fuselage['min'][2]==48
    assert fuselage['max'][0]-fuselage['min'][0]<5

def test_specific_aircraft_dimensions_and_shaded_surfaces():
    for filename,length,span in [('airbus-a350-900',66.8,64.75),('airbus-a350-1000',73.78,64.75),('boeing-777-200lr',63.7,64.8),('boeing-777-300er',73.9,64.8)]:
        blob=Path('frontend/public/models/'+filename+'.glb').read_bytes()
        count=struct.unpack_from('<I',blob,12)[0];model=json.loads(blob[20:20+count])
        assert struct.unpack_from('<I',blob,8)[0]==len(blob)
        positions=[model['accessors'][p['attributes']['POSITION']] for p in model['meshes'][0]['primitives']]
        assert abs(max(p['max'][2] for p in positions)-min(p['min'][2] for p in positions)-length)<.001
        assert abs(max(p['max'][0] for p in positions)-min(p['min'][0] for p in positions)-span)<.001
        for primitive in model['meshes'][0]['primitives']:
            normal=model['accessors'][primitive['attributes']['NORMAL']]
            assert normal['count']==model['accessors'][primitive['attributes']['POSITION']]['count']
        assert len(blob)<750_000
        assert "Polyfork" in model["asset"]["copyright"]
        assert model["asset"]["extras"]["licenseUrl"]=="https://creativecommons.org/licenses/by/4.0/"


def test_a320_model_fits_flight_axes_and_preserves_source_credit():
    blob = Path('frontend/public/models/airbus-a320-200.glb').read_bytes()
    size = struct.unpack_from('<I', blob, 12)[0]
    model = json.loads(blob[20:20 + size])
    root = model['scenes'][model['scene']]['nodes'][0]
    transform = model['nodes'][root]['matrix']

    def bounds(axis, material=None):
        values = []
        for mesh in model['meshes']:
            for primitive in mesh['primitives']:
                if material and model['materials'][primitive['material']]['name'] != material:
                    continue
                position = model['accessors'][primitive['attributes']['POSITION']]
                values.extend(
                    sum(value * transform[4 * coordinate + axis] for coordinate, value in enumerate(point))
                    + transform[12 + axis]
                    for point in (position['min'], position['max'])
                )
        return min(values), max(values)

    tail, nose = bounds(2)
    assert abs(nose - tail - 37.57) < .001
    assert abs(tail + nose) < .001
    left, right = bounds(0)
    assert 33 < right - left < 35
    belly, tail_top = bounds(1)
    assert -3 < belly < -2 and 7 < tail_top < 8
    assert 15 < bounds(2, 'CockpitGlass')[0] < nose
    assert 'Airbus5717' in model['asset']['copyright']
    assert model['asset']['extras']['licenseUrl'] == 'https://creativecommons.org/licenses/by-nc/4.0/'

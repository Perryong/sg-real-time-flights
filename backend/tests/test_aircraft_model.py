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

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

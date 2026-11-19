import hashlib
import json
from pathlib import Path
from geographiclib.geodesic import Geodesic
from backend.app.main import load_airport

def test_runway_thresholds_and_pavement_are_distinct():
    airport=load_airport(); features=airport['runways']['features']
    assert len(features)==3
    west=next(f for f in features if f['properties']['name']=='02L / 20R')
    p=west['properties']
    assert p['operational_status']=='unknown'
    assert abs(p['thresholds'][1]['displaced_m']-740)<1
    assert p['authoritative'] is False
    end=west['geometry']['coordinates'][1]; threshold=p['thresholds'][1]['coordinate']
    assert 738<Geodesic.WGS84.Inverse(end[1],end[0],threshold[1],threshold[0])['s12']<742
    for f in features:
        a,b=f['geometry']['coordinates']; distance=Geodesic.WGS84.Inverse(a[1],a[0],b[1],b[0])
        assert abs(distance['s12']-4000)<30  # Community source precision; authoritative gate remains unmet.
        assert abs(distance['azi1']-23)<.25  # OurAirports integer bearing; not the CAAS 0.1° acceptance gate.

def test_geometry_has_sources_checksums_and_real_terminal_footprints():
    a=load_airport()
    assert len(a['taxiways']['features'])>10
    assert len(a['buildings']['features'])>3
    for layer in ('runways','taxiways','buildings'):
        meta=a['layers'][layer]
        assert meta['source_url'] and meta['retrieved'] and meta['reuse_status']
        assert meta['sha256']==hashlib.sha256(Path('data/airport',layer+'.geojson').read_bytes()).hexdigest()

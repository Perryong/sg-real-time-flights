"""Rebuild licensed visualization geometry from source extracts (no CAAS charts)."""
import argparse, json, hashlib
from pathlib import Path
from xml.etree import ElementTree as E
from geographiclib.geodesic import Geodesic

def build(osm_path, runways_path):
    root=E.parse(osm_path).getroot()
    nodes={n.get('id'):[float(n.get('lon')),float(n.get('lat'))] for n in root.findall('node')}
    layers={'runways':[],'taxiways':[],'buildings':[]}
    for w in root.findall('way'):
        tags={t.get('k'):t.get('v') for t in w.findall('tag')}
        layer='taxiways' if tags.get('aeroway')=='taxiway' else 'buildings' if tags.get('aeroway') in ('terminal','hangar','tower') or tags.get('building') in ('transportation','terminal') else None
        if not layer: continue
        refs=[n.get('ref') for n in w.findall('nd')]
        if not all(r in nodes for r in refs): continue
        coords=[nodes[r] for r in refs]
        if len(coords)<2 or (layer=='buildings' and (len(coords)<4 or coords[0]!=coords[-1])): continue
        try: height=float(tags.get('height','18'))
        except ValueError: height=18
        layers[layer].append({'type':'Feature','geometry':{'type':'LineString' if layer=='taxiways' else 'Polygon','coordinates':coords if layer=='taxiways' else [coords]},'properties':{'id':'osm-way-'+w.get('id'),'name':tags.get('name',tags.get('ref','Airport building' if layer=='buildings' else 'Taxiway')),'height_m':height,'height_estimated':'height' not in tags,'source':'OpenStreetMap','source_id':w.get('id')}})
    for r in json.loads(Path(runways_path).read_text()):
        a=[float(r['le_longitude_deg']),float(r['le_latitude_deg'])]; b=[float(r['he_longitude_deg']),float(r['he_latitude_deg'])]
        g=Geodesic.WGS84.Inverse(a[1],a[0],b[1],b[0]); thresholds=[]
        for side,point,other in [('le',a,b),('he',b,a)]:
            displacement=float(r[side+'_displaced_threshold_ft'] or 0)*.3048
            heading=Geodesic.WGS84.Inverse(point[1],point[0],other[1],other[0])['azi1']
            p=Geodesic.WGS84.Direct(point[1],point[0],heading,displacement)
            thresholds.append({'id':r[side+'_ident'],'coordinate':[p['lon2'],p['lat2']],'displaced_m':displacement,'bearing':heading%360,'elevation_m':float(r[side+'_elevation_ft'] or 0)*.3048})
        layers['runways'].append({'type':'Feature','geometry':{'type':'LineString','coordinates':[a,b]},'properties':{'id':r['id'],'name':r['le_ident']+' / '+r['he_ident'],'source':'OurAirports','operational_status':'unknown','authoritative':False,'width_m':float(r['width_ft'])*.3048,'length_m':g['s12'],'bearing':g['azi1'],'thresholds':thresholds,'precision_note':'Provisional community coordinates; authoritative CAAS comparison/reuse gate unmet.'}})
    target=Path('data/airport'); target.mkdir(exist_ok=True,parents=True)
    manifest={'name':'Singapore Changi International','edition':'Open geometry · 19 NOV 2026','verification':'provisional','coordinate_reference':'WGS84 longitude, latitude','vertical_reference':'Ellipsoid fallback; MSL/barometric aircraft heights are display approximations, never touchdown evidence.','caveat':'Community airport geometry; authoritative geometry verification pending. Operational runway availability unknown. Building heights may be estimated.','sources':[{'name':'OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright','license':'ODbL 1.0'},{'name':'OurAirports','url':'https://github.com/davidmegginson/ourairports-data','license':'Unlicense'}],'layers':{}}
    for name,features in layers.items():
        p=target/(name+'.geojson'); p.write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':'))+'\n')
        manifest['layers'][name]={'publisher':'OurAirports' if name=='runways' else 'OpenStreetMap contributors','source_url':manifest['sources'][1 if name=='runways' else 0]['url'],'retrieved':'2026-11-19','effective_date':None,'publication_date':None,'coordinate_reference':'WGS84','extraction':'OurAirports endpoints plus geodesic displaced thresholds' if name=='runways' else 'OSM ways via API 0.6 map, original vertices','reuse_status':'Unlicense' if name=='runways' else 'ODbL 1.0; derived data supplied under ODbL','reviewer':'automated import; authoritative review pending','sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        print(name,len(features))
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('osm');p.add_argument('runways');args=p.parse_args();build(args.osm,args.runways)

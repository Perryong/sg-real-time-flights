import json, hashlib
from pathlib import Path
from geographiclib.geodesic import Geodesic
p=Path('data/airport'); m=json.loads((p/'manifest.json').read_text())
for name,meta in m['layers'].items():
 data=(p/(name+'.geojson')).read_bytes()
 assert hashlib.sha256(data).hexdigest()==meta['sha256']
 print(name,len(json.loads(data)['features']),'features; checksum OK')
for f in json.loads((p/'runways.geojson').read_text())['features']:
 a,b=f['geometry']['coordinates']; g=Geodesic.WGS84.Inverse(a[1],a[0],b[1],b[0])
 print(f['properties']['name'],round(g['s12'],2),'m',round(g['azi1'],3),'degrees; provisional')
print('Authoritative CAAS precision/reuse gate: UNMET. No operational availability claims.')

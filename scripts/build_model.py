"""Original generic airliner, no third-party mesh. glTF Y-up, nose +X."""
import json, math, struct
from pathlib import Path
vertices=[]; indices=[]
def triangle(a,b,c):
    start=len(vertices); vertices.extend([a,b,c]); indices.extend([start,start+1,start+2])
# Tapered 48 m fuselage.
rings=[(-24,.2),(-21,1.2),(-15,2.2),(12,2.2),(19,1.6),(24,0)]
for (x,r),(xx,rr) in zip(rings,rings[1:]):
    for i in range(16):
        a=i*math.tau/16; b=(i+1)*math.tau/16
        p=(x,math.sin(a)*r,math.cos(a)*r); q=(x,math.sin(b)*r,math.cos(b)*r)
        s=(xx,math.sin(a)*rr,math.cos(a)*rr); t=(xx,math.sin(b)*rr,math.cos(b)*rr)
        triangle(p,q,s); triangle(q,t,s)
# Wings and horizontal/vertical stabilizers, double-sided material.
for sign in (-1,1):
    triangle((6,0,sign*1),(-7,.5,sign*23),(-13,0,sign*22))
    triangle((6,0,sign*1),(-13,0,sign*22),(-7,0,sign*1))
    triangle((-15,1,sign*1),(-23,2,sign*9),(-23,1,sign*1))
triangle((-14,1,0),(-23,10,0),(-24,1,0))
bin_data=b''.join(struct.pack('<fff',*v) for v in vertices)
minv=[min(v[i] for v in vertices) for i in range(3)]; maxv=[max(v[i] for v in vertices) for i in range(3)]
doc={'asset':{'version':'2.0','generator':'Changi Observatory original procedural model'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}], 'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':0}]}], 'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.83,.92,.94,1],'metallicFactor':.3,'roughnessFactor':.6}}], 'buffers':[{'byteLength':len(bin_data)}], 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(bin_data),'target':34962}], 'accessors':[{'bufferView':0,'componentType':5126,'count':len(vertices),'type':'VEC3','min':minv,'max':maxv}]}
j=json.dumps(doc,separators=(',',':')).encode(); j+=b' '*((-len(j))%4); bin_data+=b'\0'*((-len(bin_data))%4)
blob=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(bin_data))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(bin_data),0x004e4942)+bin_data
Path('frontend/public/models/generic-aircraft.glb').write_bytes(blob)
print('Original generic model:',len(vertices),'vertices,',len(blob),'bytes')

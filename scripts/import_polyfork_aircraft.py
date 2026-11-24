"""Adapt Polyfork's CC BY 4.0 widebody GLB to approximate family proportions.
Uses only the redistributable mesh, not Polyfork's source module. Bakes node
transforms, removes unobserved landing gear, recentres at the fuselage, and
adds A350-style raised tips. Reproduce from the credited source in data/models.
"""
import json,math,struct
from collections import defaultdict
from pathlib import Path
SOURCE=Path('data/models/polyfork-widebody-source.glb')
IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
def mul(a,b):return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]
def transform(m,v,direction=False):return [sum(m[k*4+r]*v[k] for k in range(3))+(0 if direction else m[12+r]) for r in range(3)]
def norm(v):
 size=math.sqrt(sum(x*x for x in v));return [x/size for x in v] if size else [0,1,0]
def matrix(n):
 if 'matrix' in n:return n['matrix']
 x,y,z,w=n.get('rotation',[0,0,0,1]);sx,sy,sz=n.get('scale',[1,1,1]);t=n.get('translation',[0,0,0])
 return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,*t,1]
def read():
 b=SOURCE.read_bytes();length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);binary=b[28+length:]
 def accessor(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];fmt={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']];size=struct.calcsize(fmt)*width;stride=v.get('byteStride',size);start=v.get('byteOffset',0)+a.get('byteOffset',0)
  return [struct.unpack_from('<'+fmt*width,binary,start+k*stride) for k in range(a['count'])]
 meshes=[]
 def visit(i,parent):
  n=j['nodes'][i];name=n.get('name','')
  if name.startswith(('gear-','wheels-')):return
  m=mul(parent,matrix(n))
  if 'mesh' in n:
   for primitive in j['meshes'][n['mesh']]['primitives']:
    a=primitive['attributes'];positions=accessor(a['POSITION']);normals=accessor(a['NORMAL']);colors=accessor(a['COLOR_0']) if 'COLOR_0' in a else [(1,1,1)]*len(positions)
    indices=[v[0] for v in accessor(primitive['indices'])] if 'indices' in primitive else list(range(len(positions)))
    vertices=[(transform(m,p),norm(transform(m,n,True)),c[:3]) for p,n,c in zip(positions,normals,colors)]
    meshes.append((vertices,indices))
  for c in n.get('children',[]):visit(c,m)
 for root in j['scenes'][j.get('scene',0)]['nodes']:visit(root,IDENTITY)
 return j,meshes

def build(name,length,span,airbus):
 original,meshes=read();vertices=[];indices=[];sx=span/60;sz=length/64.002
 for vs,ids in meshes:
  offset=len(vertices);indices.extend(i+offset for i in ids)
  for p,n,c in vs:
   x,y,z=p;rise=0;derivative=0
   if airbus and abs(x)>25 and z>-20:
    t=(abs(x)-25)/5;rise=3*t*t;derivative=(1 if x>0 else -1)*1.2*t
   # Neutral blue tail, without representing an airline livery.
   if y>9 and z<-18:c=(.035,.19,.42)
   vertices.append(((x*sx,y-5.5+rise,z*sz),norm(((n[0]-derivative*n[1])/sx,n[1],n[2]/sz)),c))
 # Smooth coincident surface normals while preserving hard creases and paint boundaries.
 groups=defaultdict(set)
 for p,n,c in vertices:groups[(tuple(round(x,5) for x in p),c)].add(tuple(n))
 smoothed=[]
 for p,n,c in vertices:
  neighbors=[q for q in groups[(tuple(round(x,5) for x in p),c)] if sum(a*b for a,b in zip(n,q))>.75]
  smoothed.append((p,norm([sum(q[k] for q in neighbors) for k in range(3)]),c))
 vertices=smoothed
 data=bytearray();views=[];accessors=[];attrs={}
 for field,key in enumerate(('POSITION','NORMAL','COLOR_0')):
  vals=[v[field] for v in vertices];offset=len(data)
  for v in vals:data.extend(struct.pack('<fff',*v))
  views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)-offset,'target':34962})
  a={'bufferView':len(views)-1,'componentType':5126,'count':len(vals),'type':'VEC3'}
  if field==0:a.update(min=[min(v[i] for v in vals) for i in range(3)],max=[max(v[i] for v in vals) for i in range(3)])
  attrs[key]=len(accessors);accessors.append(a)
 offset=len(data)
 for i in indices:data.extend(struct.pack('<I',i))
 views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)-offset,'target':34963});accessors.append({'bufferView':len(views)-1,'componentType':5125,'count':len(indices),'type':'SCALAR'})
 asset={**original['asset'],'generator':'Changi Observatory adaptation of Polyfork Widebody Airliner','extras':{**original['asset']['extras'],'modifications':'Baked mesh transforms, landing gear removed, centred and scaled for approximate type proportions; raised A350 tips, smoothed surface normals and neutral blue tail. Not an exact aircraft replica.'}}
 doc={'asset':asset,'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':[{'attributes':attrs,'indices':len(accessors)-1,'material':0}]}],'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':.08,'roughnessFactor':.42}}],'buffers':[{'byteLength':len(data)}],'bufferViews':views,'accessors':accessors}
 header=json.dumps(doc,separators=(',',':')).encode();header+=b' '*(-len(header)%4);data+=b'\0'*(-len(data)%4)
 blob=struct.pack('<III',0x46546c67,2,28+len(header)+len(data))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(data),0x004e4942)+data
 Path('frontend/public/models',name+'.glb').write_bytes(blob);print(name,len(blob),'bytes')

if __name__=='__main__':
 for args in [('airbus-a350-900',66.8,64.75,True),('airbus-a350-1000',73.78,64.75,True),('boeing-777-200lr',63.7,64.8,False),('boeing-777-300er',73.9,64.8,False)]:build(*args)

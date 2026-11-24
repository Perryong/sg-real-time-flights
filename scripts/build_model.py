"""Original generic airliner; glTF Y-up, +Z nose for Cesium's model convention."""
import json, math, struct
from pathlib import Path
parts=[[],[],[]]  # fuselage/engines, wings, blue tail; no airline livery

def triangle(a,b,c,part=0):
    # Design in X-forward coordinates, rotate to glTF +Z forward.
    points=[(-z,y,x) for x,y,z in (a,b,c)]
    u=[points[1][i]-points[0][i] for i in range(3)]
    v=[points[2][i]-points[0][i] for i in range(3)]
    n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
    length=math.sqrt(sum(x*x for x in n))
    if length==0:return
    n=[x/length for x in n]
    parts[part].extend((p,n) for p in points)

def body(rings,y=0,z=0):
    for (x,r),(xx,rr) in zip(rings,rings[1:]):
        for i in range(24):
            a=i*math.tau/24;b=(i+1)*math.tau/24
            p=(x,y+math.sin(a)*r,z+math.cos(a)*r);q=(x,y+math.sin(b)*r,z+math.cos(b)*r)
            s=(xx,y+math.sin(a)*rr,z+math.cos(a)*rr);t=(xx,y+math.sin(b)*rr,z+math.cos(b)*rr)
            triangle(p,s,q);triangle(q,s,t)

body([(-24,.2),(-21,1.2),(-15,2.2),(12,2.2),(19,1.6),(24,0)])
# Save the fuselage as its own primitive to validate its axis independently.
fuselage=parts[0];parts[0]=[]
for sign in (-1,1):
    points=[(6,0,sign*1),(-7,.5,sign*23),(-13,0,sign*22),(-7,0,sign*1)]
    a,b,c,d=points
    triangle(a,c,b,1) if sign==1 else triangle(a,b,c,1)
    triangle(a,d,c,1) if sign==1 else triangle(a,c,d,1)
    a,b,c=(-15,1,sign*1),(-23,2,sign*9),(-23,1,sign*1)
    triangle(a,c,b,1) if sign==1 else triangle(a,b,c,1)
    body([(-7,.5),(-6,1.4),(0,1.5),(1,1.2),(1.2,0)],-2,sign*7)
triangle((-14,1,0),(-23,10,0),(-24,1,0),2)
parts=[fuselage,*parts]
materials=[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':.1,'roughnessFactor':.6}} for color in ([.82,.86,.89,1],[.65,.72,.78,1],[.05,.24,.42,1])]
bin_data=bytearray();views=[];accessors=[];primitives=[]
for part,material in zip(parts,[0,0,1,2]):
    attributes={}
    for field,name in enumerate(('POSITION','NORMAL')):
        values=[v[field] for v in part];offset=len(bin_data)
        for value in values:bin_data.extend(struct.pack('<fff',*value))
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(bin_data)-offset,'target':34962})
        accessor={'bufferView':len(views)-1,'componentType':5126,'count':len(values),'type':'VEC3'}
        if field==0:accessor.update(min=[min(v[i] for v in values) for i in range(3)],max=[max(v[i] for v in values) for i in range(3)])
        attributes[name]=len(accessors);accessors.append(accessor)
    primitives.append({'attributes':attributes,'material':material})
doc={'asset':{'version':'2.0','generator':'Changi Observatory original procedural model'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':primitives}],'materials':materials,'buffers':[{'byteLength':len(bin_data)}],'bufferViews':views,'accessors':accessors}
j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);bin_data+=b'\0'*((-len(bin_data))%4)
blob=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(bin_data))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(bin_data),0x004e4942)+bin_data
Path('frontend/public/models/generic-aircraft.glb').write_bytes(blob)
print('Original generic model:',sum(len(p) for p in parts),'vertices,',len(blob),'bytes')

"""Original simplified A350/777 visualization meshes. No third-party mesh or livery.
Dimensions: Airbus A350 family specifications and Boeing 777 specifications.
Run from repository root. Y-up / +Z nose; GLB material normals support Cesium lighting.
"""
import json,math,struct
from pathlib import Path

COLORS=[(.89,.92,.94,1),(.57,.64,.70,1),(.035,.22,.36,1),(.018,.045,.065,1),(.035,.04,.045,1),(.29,.33,.37,1)]

def unit(v):
 n=math.sqrt(sum(x*x for x in v));return tuple(x/n for x in v) if n else (0,1,0)
def axis(p):return (-p[2],p[1],p[0])
class Mesh:
 def __init__(self):self.parts=[[] for _ in COLORS]
 def tri(self,a,b,c,mat=0,normals=None):
  u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
  n=unit((u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]))
  for p,normal in zip((a,b,c),normals or (n,n,n)):self.parts[mat].append((axis(p),axis(normal)))
 def quad(self,a,b,c,d,mat=0):self.tri(a,b,c,mat);self.tri(a,c,d,mat)
 def tube(self,rings,y=0,z=0,mat=0):
  segments=48
  slopes=[]
  for i in range(len(rings)):
   a=rings[max(0,i-1)];b=rings[min(len(rings)-1,i+1)]
   slopes.append((b[1]-a[1])/(b[0]-a[0]) if b[0]!=a[0] else 0)
  for j,((x,r),(xx,rr)) in enumerate(zip(rings,rings[1:])):
   for i in range(segments):
    a=i*math.tau/segments;b=(i+1)*math.tau/segments
    p=(x,y+math.sin(a)*r,z+math.cos(a)*r);q=(x,y+math.sin(b)*r,z+math.cos(b)*r)
    s=(xx,y+math.sin(a)*rr,z+math.cos(a)*rr);t=(xx,y+math.sin(b)*rr,z+math.cos(b)*rr)
    n=lambda k,angle:unit((-slopes[k],math.sin(angle),math.cos(angle)))
    self.tri(p,s,q,mat,(n(j,a),n(j+1,a),n(j,b)));self.tri(q,s,t,mat,(n(j,b),n(j+1,a),n(j+1,b)))
 def wing(self,sections,sign,mat=1):
  # Closed airfoil sections give real thickness and a shaded leading edge.
  profiles=[]
  for leading,trailing,y,z,thickness in sections:
   chord=leading-trailing
   profiles.append([(leading,y,sign*z),(leading-chord*.22,y+thickness,sign*z),(trailing,y+thickness*.08,sign*z),(leading-chord*.22,y-thickness*.55,sign*z)])
  for a,b in zip(profiles,profiles[1:]):
   for i in range(4):self.quad(a[i],b[i],b[(i+1)%4],a[(i+1)%4],mat)
  self.quad(*profiles[-1],mat)
 def save(self,name,description):
  data=bytearray();views=[];accessors=[];primitives=[]
  for mat,part in enumerate(self.parts):
   if not part:continue
   attributes={}
   for field,key in enumerate(('POSITION','NORMAL')):
    values=[p[field] for p in part];start=len(data)
    for v in values:data.extend(struct.pack('<fff',*v))
    views.append({'buffer':0,'byteOffset':start,'byteLength':len(data)-start,'target':34962})
    acc={'bufferView':len(views)-1,'componentType':5126,'count':len(values),'type':'VEC3'}
    if field==0:acc.update(min=[min(v[i] for v in values) for i in range(3)],max=[max(v[i] for v in values) for i in range(3)])
    attributes[key]=len(accessors);accessors.append(acc)
   primitives.append({'attributes':attributes,'material':mat})
  materials=[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':.35 if i in (1,5) else .05,'roughnessFactor':.28 if i==3 else .55}} for i,c in enumerate(COLORS)]
  doc={'asset':{'version':'2.0','generator':'Changi Observatory original aircraft visualization','extras':{'description':description,'accuracy':'Simplified proportions; not engineering geometry or airline livery'}},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':primitives}],'materials':materials,'buffers':[{'byteLength':len(data)}],'bufferViews':views,'accessors':accessors}
  j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*(-len(j)%4);data+=b'\0'*(-len(data)%4)
  blob=struct.pack('<III',0x46546c67,2,28+len(j)+len(data))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(data),0x004e4942)+data
  Path('frontend/public/models',name+'.glb').write_bytes(blob)
  print(name,len(blob),'bytes')

def aircraft(name,length,span,width,airbus):
 m=Mesh();L=length;R=width/2;half=span/2
 m.tube([(-L*.5,.04),(-L*.47,.5),(-L*.40,R*.67),(-L*.31,R),(.31*L,R),(.37*L,R*.98),(.42*L,R*.84),(.46*L,R*.57),(.485*L,R*.25),(.5*L,.035)])
 for sign in (-1,1):
  sections=[(.10*L,-.14*L,-.7,R*.8,.52),(-.025*L,-.135*L,-.15,half*.42,.28),(-.155*L,-.20*L,.9,half*.84,.12)]
  if airbus:sections +=[(-.20*L,-.235*L,1.7,half*.95,.10),(-.235*L,-.253*L,3.4,half*.985,.06),(-.25*L,-.263*L,4.5,half,.025)]
  else:sections +=[(-.20*L,-.235*L,1.35,half*.92,.08),(-.255*L,-.275*L,1.6,half,.025)]
  m.wing(sections,sign)
  m.wing([(-.34*L,-.44*L,1,R*.75,.25),(-.46*L,-.49*L,2,span*.17,.04)],sign)
  # Wing pylon and larger 777 nacelle; dark inset fan and exhaust, not sealed white cones.
  z=sign*span*.19;y=-2.9;radius=1.62 if airbus else 1.85
  m.quad((-3,-.6,z-.18),(3,-.6,z-.18),(1,-2.8,z-.18),(-3,-2.8,z-.18),1)
  m.quad((-3,-.6,z+.18),(3,-.6,z+.18),(1,-2.8,z+.18),(-3,-2.8,z+.18),1)
  m.tube([(-4.7,radius*.58),(-3.8,radius*.88),(-2,radius),(2.6,radius),(3.4,radius*.94)],y,z)
  m.tube([(2.1,radius*.78),(3.4,radius*.84)],y,z,4)
  m.tube([(3.4,radius*.84),(3.4,radius*.94)],y,z,5)
  m.tube([(-5.1,radius*.39),(-4.8,radius*.63),(-3.7,radius*.63)],y,z,5)
  m.tube([(-5.3,.05),(-4.4,radius*.34)],y,z,4)
  for blade in range(18):
   a=blade*math.tau/18;b=a+.18
   m.quad((2.15,y+math.sin(a)*.2,z+math.cos(a)*.2),(2.15,y+math.sin(b)*radius*.77,z+math.cos(b)*radius*.77),(2.3,y+math.sin(b+.16)*radius*.77,z+math.cos(b+.16)*radius*.77),(2.3,y+math.sin(a+.12)*.2,z+math.cos(a+.12)*.2),5)
  m.tube([(2.15,.34),(2.8,.03)],y,z,5)
  # Cabin windows follow the constant-radius fuselage, with a separate cockpit mask.
  for i in range(int(L*.59/.82)):
   x=-L*.29+i*.82;ywin=R*.36;zw=sign*math.sqrt(R*R-ywin*ywin)*1.006
   m.quad((x-.16,ywin-.19,zw),(x+.16,ywin-.19,zw),(x+.16,ywin+.19,zw),(x-.16,ywin+.19,zw),3)
  mask=[(.39*L,R*.42,sign*R*.85),(.425*L,R*.42,sign*R*.66),(.447*L,R*.19,sign*R*.57),(.405*L,R*.20,sign*R*.86)]
  m.quad(*mask,3)
  # Subtle door panels, no invented airline markings.
  for x in (-L*.275,-L*.04,L*.28):
   m.quad((x-.32,-.9,sign*R*.96),(x+.32,-.9,sign*R*.96),(x+.32,1.5,sign*R*.87),(x-.32,1.5,sign*R*.87),1)
 # Thick vertical stabilizer, navy generic paint.
 for sign in (-1,1):
  m.quad((-.28*L,1,sign*.18),(-.435*L,11.4,sign*.07),(-.485*L,11.4,sign*.07),(-.48*L,1,sign*.18),2)
 m.quad((-.435*L,11.4,-.07),(-.435*L,11.4,.07),(-.485*L,11.4,.07),(-.485*L,11.4,-.07),2)
 m.save(name,('Airbus A350' if airbus else 'Boeing 777')+f' simplified model: length {length} m, span {span} m')

if __name__=='__main__':
 for args in [('airbus-a350-900',66.8,64.75,5.96,True),('airbus-a350-1000',73.78,64.75,5.96,True),('boeing-777-200lr',63.7,64.8,6.19,False),('boeing-777-300er',73.9,64.8,6.19,False)]:aircraft(*args)

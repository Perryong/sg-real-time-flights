import {regions} from '../data/regions';
import type {WindPoint} from '../data/weather';
import {WIND_SPEED_STOPS} from '../data/windScale';

type Position = {lon:number;lat:number};
type Velocity = {east:number;north:number};
type Corner = WindPoint & Velocity;
type Bounds = {west:number;south:number;east:number;north:number};
type Cell = Bounds & {row:number;column:number;corners:[Corner,Corner,Corner,Corner]};
type WindField = {cells:Cell[];isolated:WindPoint[]};

const center=regions.singapore;
const radians=Math.PI/180;
const earthRadius=6371;
const angularRadius=center.radius/earthRadius;
const centerCos=Math.cos(center.lat*radians);
const longitudeSpan=Math.asin(Math.sin(angularRadius)/centerCos)/radians;
const radiusHaversine=Math.sin(angularRadius/2)**2;
export const regionalWindBounds:Bounds={
  west:center.lon-longitudeSpan,south:center.lat-angularRadius/radians,
  east:center.lon+longitudeSpan,north:center.lat+angularRadius/radians,
};

export function withinWindRegion(lon:number,lat:number):boolean {
  return Math.sin((lat-center.lat)*radians/2)**2
    +centerCos*Math.cos(lat*radians)*Math.sin((lon-center.lon)*radians/2)**2 <= radiusHaversine;
}

export function buildWindField(points:readonly WindPoint[]):WindField {
  // The wind response contains only samples from its single model valid time.
  const grid=new Map<string,Corner>();
  for(const point of points){
    const from=point.from_deg*radians;
    grid.set(point.id,{...point,east:-point.speed_mps*Math.sin(from),north:-point.speed_mps*Math.cos(from)});
  }
  const cells:Cell[]=[];
  const covered=new Set<string>();
  for(const sw of grid.values()){
    const index=/^regional:(-?[0-4]):(-?[0-4])$/.exec(sw.id);
    if(!index) continue;
    const row=Number(index[1]), column=Number(index[2]);
    const se=grid.get(`regional:${row}:${column+1}`);
    const nw=grid.get(`regional:${row+1}:${column}`);
    const ne=grid.get(`regional:${row+1}:${column+1}`);
    if(!se||!nw||!ne) continue;
    const corners:[Corner,Corner,Corner,Corner]=[sw,se,nw,ne];
    const lons=corners.map(p=>p.lon), lats=corners.map(p=>p.lat);
    cells.push({row,column,corners,west:Math.min(...lons),east:Math.max(...lons),south:Math.min(...lats),north:Math.max(...lats)});
    for(const corner of corners) covered.add(corner.id);
  }
  return {cells,isolated:points.filter(p=>!covered.has(p.id))};
}

function interpolate(sw:number,se:number,nw:number,ne:number,u:number,v:number):number {
  return (sw+(se-sw)*u)*(1-v)+(nw+(ne-nw)*u)*v;
}

function sampleCell(cell:Cell,lon:number,lat:number,out:Velocity):boolean {
  const [sw,se,nw,ne]=cell.corners;
  const eastLon=se.lon-sw.lon, eastLat=se.lat-sw.lat;
  const northLon=nw.lon-sw.lon, northLat=nw.lat-sw.lat;
  const crossLon=ne.lon-se.lon-nw.lon+sw.lon, crossLat=ne.lat-se.lat-nw.lat+sw.lat;
  let u=.5, v=.5;
  // Invert the bilinear map of model coordinates. The corners need not form a rectangle.
  for(let i=0;i<5;i++){
    const dx=sw.lon+u*eastLon+v*northLon+u*v*crossLon-lon;
    const dy=sw.lat+u*eastLat+v*northLat+u*v*crossLat-lat;
    const ux=eastLon+v*crossLon, uy=eastLat+v*crossLat;
    const vx=northLon+u*crossLon, vy=northLat+u*crossLat;
    const det=ux*vy-vx*uy;
    if(Math.abs(det)<1e-8) return false;
    u-=(dx*vy-dy*vx)/det;
    v-=(dy*ux-dx*uy)/det;
  }
  if(u< -1e-8||u>1+1e-8||v< -1e-8||v>1+1e-8) return false;
  out.east=interpolate(sw.east,se.east,nw.east,ne.east,u,v);
  out.north=interpolate(sw.north,se.north,nw.north,ne.north,u,v);
  return true;
}

export function sampleWind(field:WindField,lon:number,lat:number):Velocity|undefined {
  if(!withinWindRegion(lon,lat)) return;
  const wind={east:0,north:0};
  for(const cell of field.cells){
    if(lon>=cell.west&&lon<=cell.east&&lat>=cell.south&&lat<=cell.north&&sampleCell(cell,lon,lat,wind)) return wind;
  }
}

const palette=WIND_SPEED_STOPS.map(({speed,color})=>{
  const rgb=Number.parseInt(color.slice(1),16);
  return {speed,red:rgb>>16,green:(rgb>>8)&255,blue:rgb&255};
});

export function rasterWindField(field:WindField,size:number):Uint8ClampedArray<ArrayBuffer> {
  const pixels=new Uint8ClampedArray(size*size*4);
  const {west,south,east,north}=regionalWindBounds;
  const lonStep=(east-west)/size, latStep=(north-south)/size;
  const wind={east:0,north:0};
  const covered=new Set(field.cells.map(cell=>cell.corners[0].id));
  for(const cell of field.cells){
    const {row,column}=cell;
    const openWest=!covered.has(`regional:${row}:${column-1}`);
    const openEast=!covered.has(`regional:${row}:${column+1}`);
    const openSouth=!covered.has(`regional:${row-1}:${column}`);
    const openNorth=!covered.has(`regional:${row+1}:${column}`);
    const left=Math.max(0,Math.floor((cell.west-west)/lonStep));
    const right=Math.min(size,Math.ceil((cell.east-west)/lonStep));
    const top=Math.max(0,Math.floor((north-cell.north)/latStep));
    const bottom=Math.min(size,Math.ceil((north-cell.south)/latStep));
    for(let y=top;y<bottom;y++){
      const lat=north-(y+.5)*latStep;
      for(let x=left;x<right;x++){
        const lon=west+(x+.5)*lonStep;
        if(!withinWindRegion(lon,lat)||!sampleCell(cell,lon,lat,wind)) continue;
        const speed=Math.min(10,Math.hypot(wind.east,wind.north));
        const upper=speed<=2?1:speed<=5?2:3;
        const a=palette[upper-1], b=palette[upper];
        const t=(speed-a.speed)/(b.speed-a.speed);
        const offset=(y*size+x)*4;
        pixels[offset]=a.red+(b.red-a.red)*t;
        pixels[offset+1]=a.green+(b.green-a.green)*t;
        pixels[offset+2]=a.blue+(b.blue-a.blue)*t;
        // Feather only unsupported edges. Neighboring model cells meet at full opacity.
        const edge=Math.min(openWest ? lon-cell.west : Infinity,openEast ? cell.east-lon : Infinity,
          openSouth ? lat-cell.south : Infinity,openNorth ? cell.north-lat : Infinity);
        pixels[offset+3]=255*Math.min(1,edge/.28);
      }
    }
  }
  return pixels;
}

export function windPaths(field:WindField):Position[][] {
  const paths:Position[][]=[];
  const step=8/(earthRadius*radians);
  for(const [index,cell] of field.cells.entries()){
    const [sw,se,nw,ne]=cell.corners;
    for(let i=0;i<6;i++){
      const u=(i%3+.5)/3+Math.sin(index*13+i*19)*.08;
      const v=(Math.floor(i/3)+.5)/2+Math.cos(index*17+i*11)*.12;
      let lon=interpolate(sw.lon,se.lon,nw.lon,ne.lon,u,v);
      let lat=interpolate(sw.lat,se.lat,nw.lat,ne.lat,u,v);
      const path:Position[]=[];
      for(let j=0;j<=6;j++){
        const wind=sampleWind(field,lon,lat);
        if(!wind) break;
        const speed=Math.hypot(wind.east,wind.north);
        if(speed<.01) break;
        path.push({lon,lat});
        lon+=step*wind.east/(speed*Math.cos(lat*radians));
        lat+=step*wind.north/speed;
      }
      if(path.length>=3) paths.push(path);
    }
  }
  return paths;
}

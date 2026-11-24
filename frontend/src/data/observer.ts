import type {Observation,Track} from './types';
export interface ObserverPin {lat:number;lon:number;height:number;label?:string}
const rad=Math.PI/180;
export const isSingaporePin=(p:ObserverPin)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.height)&&p.lat>=1.15&&p.lat<=1.48&&p.lon>=103.59&&p.lon<=104.11&&p.height>=2&&p.height<=500;
// WGS84 ECEF coordinates keep elevation consistent with Cesium's ellipsoid.
function ecef(lat:number,lon:number,height:number) {
 const phi=lat*rad,lambda=lon*rad,n=6378137/Math.sqrt(1-0.00669437999014*Math.sin(phi)**2);
 return [(n+height)*Math.cos(phi)*Math.cos(lambda),(n+height)*Math.cos(phi)*Math.sin(lambda),(n*(1-0.00669437999014)+height)*Math.sin(phi)];
}
export function relativeAircraft(pin:ObserverPin,o:Observation) {
 const phi=pin.lat*rad,delta=(o.lon-pin.lon)*rad,lat=o.lat*rad;
 const a=Math.sin((lat-phi)/2)**2+Math.cos(phi)*Math.cos(lat)*Math.sin(delta/2)**2;
 const distanceKm=6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
 const bearing=(Math.atan2(Math.sin(delta)*Math.cos(lat),Math.cos(phi)*Math.sin(lat)-Math.sin(phi)*Math.cos(lat)*Math.cos(delta))/rad+360)%360;
 const altitude=Number.isFinite(o.alt_geom_m)?o.alt_geom_m:Number.isFinite(o.alt_baro_m)?o.alt_baro_m:null;
 let elevation:number|null=null;
 if(altitude!==null){
  const origin=ecef(pin.lat,pin.lon,pin.height),target=ecef(o.lat,o.lon,altitude),d=target.map((v,i)=>v-origin[i]),lambda=pin.lon*rad;
  const east=-Math.sin(lambda)*d[0]+Math.cos(lambda)*d[1];
  const north=-Math.sin(phi)*Math.cos(lambda)*d[0]-Math.sin(phi)*Math.sin(lambda)*d[1]+Math.cos(phi)*d[2];
  const up=Math.cos(phi)*Math.cos(lambda)*d[0]+Math.cos(phi)*Math.sin(lambda)*d[1]+Math.sin(phi)*d[2];
  elevation=Math.atan2(up,Math.hypot(east,north))/rad;
 }
 return {distanceKm,bearing,direction:['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8],elevation,altitude,altitudeApproximate:!Number.isFinite(o.alt_geom_m)};
}
export function nearbyAircraft(pin:ObserverPin,tracks:Track[],now:number,radiusKm=25) {
 return tracks.filter(t=>t.latest.ground===false&&t.latest.position_time!==null&&Number.isFinite(t.latest.position_time)&&now-t.latest.position_time>=0&&now-t.latest.position_time<=20&&Number.isFinite(t.latest.lat)&&Number.isFinite(t.latest.lon))
 .map(track=>({track,...relativeAircraft(pin,track.latest)})).filter(t=>t.distanceKm<=radiusKm).sort((a,b)=>a.distanceKm-b.distanceKm);
}

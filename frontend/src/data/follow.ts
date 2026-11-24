import {displayPosition,type DisplayPosition} from './display';
import type {Track,Observation} from './types';
export interface FollowCamera {distance:number;orbit:number;elevation:number}
export const defaultFollowCamera:FollowCamera={distance:180,orbit:0,elevation:10};
export interface FollowSample extends DisplayPosition {altitude:number;placementAltitude:number;heading:number|null;headingLabel:'Heading'|'Course'|'Direction unknown';speed:number|null;altitudeLabel:string}
export const angleBetween=(a:number,b:number)=>((b-a)%360+540)%360-180;
export function followSample(t:Track,now:number):FollowSample|null {
 const o=t.latest,age=o.position_time===null?Infinity:now-o.position_time;
 if(!Number.isFinite(age)||age<0||age>20||o.ground!==false)return null;
 const p=displayPosition(t,now-10,now);
 if(p.ground!==false||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))return null;
 const samples=p.sourceTimes.map(time=>t.history.find(x=>x.position_time===time&&x.session_id===t.session_id)??o);
 let a=samples[0]??o,b=samples.at(-1)??a;
 const span=(b.position_time??0)-(a.position_time??0),f=span>0?Math.max(0,Math.min(1,(p.renderTime-a.position_time!)/span)):0;
 if(f===0)b=a;else if(f===1)a=b;
 const interpolate=(key:keyof Observation,angle=false):number|null=>{
  const av=a[key],bv=b[key];
  if(typeof av!=='number'||!Number.isFinite(av)||typeof bv!=='number'||!Number.isFinite(bv))return null;
  return angle?((av+angleBetween(av,bv)*f)%360+360)%360:av+(bv-av)*f;
 };
 const geom=interpolate('alt_geom_m'),baro=interpolate('alt_baro_m'),altitude=geom??baro;
 if(altitude===null)return null;
 const heading=interpolate('heading_deg',true),course=interpolate('track_deg',true);
 return {...p,altitude,placementAltitude:Math.max(5,altitude),heading:heading??course,headingLabel:heading!==null?'Heading':course!==null?'Course':'Direction unknown',speed:interpolate('speed_mps'),altitudeLabel:geom!==null?'Geometric altitude':'Barometric estimate'};
}

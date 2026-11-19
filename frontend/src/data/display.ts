import type { Track, Observation } from './types';
import { freshness } from './freshness';
export interface DisplayPosition {lat:number;lon:number;altitude:number|null;method:'observed'|'interpolated'|'predicted'|'last_known';renderTime:number;sourceTimes:number[];predictionDuration:number}
const altitude=(o:Observation)=>o.alt_geom_m??o.alt_baro_m;
export function displayPosition(track:Track,renderTime:number,now:number,predictionSeconds=0):DisplayPosition {
 const o=track.latest;
 const held:DisplayPosition={lat:o.lat,lon:o.lon,altitude:altitude(o),method:'last_known',renderTime:o.position_time??renderTime,sourceTimes:o.position_time===null?[]:[o.position_time],predictionDuration:0};
 if(freshness(o.position_time,now)!=='fresh')return held;
 const h=track.history;
 for(let i=1;i<h.length;i++){
  const a=h[i-1],b=h[i];const ta=a.position_time,tb=b.position_time;
  if(ta===null||tb===null||a.session_id!==b.session_id||a.id!==b.id||tb<=ta||tb-ta>20)continue;
  if(ta<=renderTime&&renderTime<=tb){
   const f=(renderTime-ta)/(tb-ta),aa=altitude(a),ab=altitude(b);
   const delta=((b.lon-a.lon+540)%360)-180;
   return {lat:a.lat+(b.lat-a.lat)*f,lon:((a.lon+delta*f+540)%360)-180,altitude:aa!==null&&ab!==null?aa+(ab-aa)*f:null,method:f===0||f===1?'observed':'interpolated',renderTime,sourceTimes:[ta,tb],predictionDuration:0};
  }
 }
 const elapsed=renderTime-o.position_time!;
 if(elapsed===0)return {...held,method:'observed'};
 if(elapsed>0&&elapsed<=Math.min(5,predictionSeconds)&&o.speed_mps!==null&&o.track_deg!==null){
  const angular=o.speed_mps*elapsed/6378137,heading=o.track_deg*Math.PI/180,lat=o.lat*Math.PI/180,lon=o.lon*Math.PI/180;
  const phi=Math.asin(Math.sin(lat)*Math.cos(angular)+Math.cos(lat)*Math.sin(angular)*Math.cos(heading));
  const lambda=lon+Math.atan2(Math.sin(heading)*Math.sin(angular)*Math.cos(lat),Math.cos(angular)-Math.sin(lat)*Math.sin(phi));
  return {...held,lat:phi*180/Math.PI,lon:lambda*180/Math.PI,method:'predicted',renderTime,predictionDuration:elapsed};
 }
 return held;
}

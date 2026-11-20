import type {Observation} from './types';
import {freshness} from './freshness';

export type ChangiIntent = 'inbound' | 'outbound' | 'unknown';
export const intentLabel = {inbound:'Likely inbound',outbound:'Likely outbound',unknown:'Direction unknown'};

export function routeFor(o:Observation,now:number) {
  const r=o.route;
  if(o.mode!=='live' || !r || r.callsign !== o.callsign?.trim().toUpperCase() || now-r.retrieved_at<0 || now-r.retrieved_at>300) return null;
  const today=Date.parse(new Date(now*1000).toISOString().slice(0,10)+'T00:00:00Z');
  const age=(today-Date.parse(r.last_seen_day+'T00:00:00Z'))/86400000;
  return age>=0 && age<=7 ? r : null;
}

export function changiIntent(o:Observation,now:number):ChangiIntent {
  const r=routeFor(o,now);
  if(!r || freshness(o.position_time,now)!=='fresh' || o.ground!==false || (o.speed_mps??0)<30 || o.track_deg==null) return 'unknown';
  const radians=Math.PI/180;
  const lat=o.lat*radians, target=1.3644*radians, delta=(103.9915-o.lon)*radians;
  // Near the airport the course to its centre is unstable; phase estimates stay separate.
  const haversine=Math.sin((target-lat)/2)**2+Math.cos(lat)*Math.cos(target)*Math.sin(delta/2)**2;
  const distance=6371*2*Math.asin(Math.sqrt(Math.min(1,haversine)));
  if(distance<1 || distance>500) return 'unknown';
  const bearing=Math.atan2(Math.sin(delta)*Math.cos(target),Math.cos(lat)*Math.sin(target)-Math.sin(lat)*Math.cos(target)*Math.cos(delta))/radians;
  const difference=Math.abs(((o.track_deg-bearing)%360+540)%360-180);
  if(r.destination==='WSSS' && r.origin!=='WSSS' && difference<=60) return 'inbound';
  if(r.origin==='WSSS' && r.destination!=='WSSS' && difference>=120) return 'outbound';
  return 'unknown';
}

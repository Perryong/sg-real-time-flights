import {describe,it,expect} from 'vitest';
import {relativeAircraft,nearbyAircraft,isSingaporePin} from './observer';
import type {Track} from './types';
const pin={lat:1.35,lon:103.85,height:2};
const now=1000;
const track=(extra:object={}):Track=>({id:'a',latest:{lat:1.36,lon:103.85,alt_geom_m:1000,alt_baro_m:null,ground:false,position_time:now,...extra}} as Track);
describe('observer geometry',()=>{
 it('reports north distance and elevation with Earth curvature',()=>{
  const r=relativeAircraft(pin,track().latest);
  expect(r.distanceKm).toBeCloseTo(1.112,2);expect(r.bearing).toBeCloseTo(0,3);
  expect(r.elevation).toBeGreaterThan(41);expect(r.elevation).toBeLessThan(43);
 });
 it('uses direction from the pin rather than aircraft heading',()=>{
  const r=relativeAircraft(pin,track({lat:1.35,lon:103.86,track_deg:270}).latest);
  expect(r.direction).toBe('E');expect(r.bearing).toBeCloseTo(90,1);
 });
 it('has no sky aim when altitude is missing and identifies barometric estimates',()=>{
  expect(relativeAircraft(pin,track({alt_geom_m:null}).latest).elevation).toBeNull();
  expect(relativeAircraft(pin,track({alt_geom_m:null,alt_baro_m:1000}).latest).altitudeApproximate).toBe(true);
 });
 it('only lists fresh airborne aircraft within the radius, nearest first',()=>{
  const tracks=[{...track({lat:1.45}),id:'far'},{...track(),id:'near'},track({ground:true}),track({position_time:900}),track({position_time:1001}),track({position_time:null}),track({lat:2}),track({lat:NaN})];
  expect(nearbyAircraft(pin,tracks,now).map(x=>x.track.id)).toEqual(['near','far']);
 });
 it('rejects invalid pins and accepts six-digit postal result coordinates in the vicinity',()=>{
  expect(isSingaporePin(pin)).toBe(true);expect(isSingaporePin({...pin,lat:2})).toBe(false);
  expect(isSingaporePin({...pin,lon:NaN})).toBe(false);expect(isSingaporePin({...pin,height:-1})).toBe(false);
 });
});

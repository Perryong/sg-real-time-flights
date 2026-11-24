import {describe,it,expect} from 'vitest';
import {followSample,angleBetween} from './follow';
import {track} from './testHelpers';
describe('follow display frame',()=>{
 it('interpolates heading across north with the same time as speed and altitude',()=>{
  const t=track([1000,1020]);t.history[0]={...t.history[0],heading_deg:350,speed_mps:100,alt_geom_m:1000};
  t.history[1]={...t.history[1],heading_deg:10,speed_mps:200,alt_geom_m:2000};t.latest=t.history[1];
  const s=followSample(t,1020)!;
  expect(s.renderTime).toBe(1010);expect(s.heading).toBeCloseTo(0);expect(s.speed).toBe(150);expect(s.altitude).toBe(1500);expect(s.headingLabel).toBe('Heading');
  expect(angleBetween(350,10)).toBe(20);expect(angleBetween(10,350)).toBe(-20);
 });
 it('labels course and unknown heading honestly',()=>{
  const t=track([1000]);expect(followSample(t,1000)?.headingLabel).toBe('Course');
  t.latest.track_deg=null;t.history=[t.latest];expect(followSample(t,1000)?.heading).toBeNull();
 });
 it('rejects stale, future, ground and unknown altitude instead of making a 3D position',()=>{
  const t=track([1000]);expect(followSample(t,1021)).toBeNull();expect(followSample(t,999)).toBeNull();
  t.latest.alt_geom_m=null;t.latest.alt_baro_m=null;t.history=[t.latest];expect(followSample(t,1000)).toBeNull();
  t.latest.alt_geom_m=1000;t.latest.ground=true;expect(followSample(t,1000)).toBeNull();
 });
 it('does not use latest altitude or speed when the buffered bracket lacks it',()=>{
  const t=track([1000,1020]);t.history[0].alt_geom_m=null;t.history[0].alt_baro_m=null;t.latest=t.history[1];
  expect(followSample(t,1020)).toBeNull();
 });
});
it('uses a common altitude source across a bracket',()=>{
 const t=track([1000,1020]);t.history[0].alt_geom_m=1200;t.history[1].alt_geom_m=null;t.latest=t.history[1];
 const p=followSample(t,1020)!;expect(p.altitude).toBe(1000);expect(p.altitudeLabel).toBe('Barometric estimate');
});
it('uses valid endpoint measurements even when the other endpoint is unknown',()=>{
 const t=track([1010,1020]);t.history[0].speed_mps=150;t.history[1].speed_mps=null;t.history[1].alt_geom_m=null;t.history[1].alt_baro_m=null;t.latest=t.history[1];
 const p=followSample(t,1020)!;expect(p.altitude).toBe(1000);expect(p.speed).toBe(150);
});
it('separates raw negative pressure altitude from shared camera/model placement',()=>{
 const t=track([1000]);t.latest.alt_geom_m=null;t.latest.alt_baro_m=-30;t.history=[t.latest];
 const p=followSample(t,1000)!;expect(p.altitude).toBe(-30);expect(p.placementAltitude).toBe(5);
});

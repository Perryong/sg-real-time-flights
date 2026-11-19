import {expect,it} from 'vitest';
import {displayPosition} from './display';
import {track} from './testHelpers';
it('interpolates only time brackets within twenty seconds',()=>{
 const p=displayPosition(track(),1005,1010);expect(p.method).toBe('interpolated');expect(p.lon).toBeCloseTo(104.005,6);
 expect(displayPosition(track([1000,1021]),1010,1021).method).not.toBe('interpolated');
});
it('prediction is opt-in, bounded, then returns to actual observation',()=>{
 const t=track();t.latest=t.history[1];
 expect(displayPosition(t,1013,1013).method).toBe('last_known');
 expect(displayPosition(t,1013,1013,5).method).toBe('predicted');
 const p=displayPosition(t,1016,1016,5);expect(p.method).toBe('last_known');expect(p.lon).toBe(104.01);
 expect(displayPosition(t,1013,1031,5).method).toBe('last_known');
 expect(t.history).toHaveLength(2);
});
it('does not interpolate across sessions or stale evidence',()=>{
 const t=track();t.history[0].session_id='old';expect(displayPosition(t,1005,1010).method).not.toBe('interpolated');
 expect(displayPosition(track(),1005,1080).method).toBe('last_known');
});

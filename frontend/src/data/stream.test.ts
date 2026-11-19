import {expect,it} from 'vitest';
import {acceptSnapshot} from './stream';
import {snapshot} from './testHelpers';
it('rejects obsolete callbacks, old sequences and epochs on the same connection',()=>{
 let state=acceptSnapshot({connectionId:1,snapshot:null},snapshot(3),1);expect(state.snapshot?.sequence).toBe(3);
 expect(acceptSnapshot(state,snapshot(2),1)).toBe(state);
 expect(acceptSnapshot(state,snapshot(4,'old'),0)).toBe(state);
 expect(acceptSnapshot(state,snapshot(4,'other'),1)).toBe(state);
 state=acceptSnapshot({...state,connectionId:2,snapshot:null},snapshot(0,'restart'),2);expect(state.snapshot?.epoch).toBe('restart');
});
it('rejects malformed nested position data and heartbeat as an observation',()=>{
 const state={connectionId:1,snapshot:null};const bad=snapshot();bad.tracks[0].latest.lat=999;
 expect(acceptSnapshot(state,bad,1)).toBe(state);
 expect(acceptSnapshot(state,{type:'heartbeat',server_time:1000},1)).toBe(state);
});

import {expect,it} from 'vitest';
import {observation} from './testHelpers';
import {changiIntent,routeFor} from './routes';
import type {HistoricalRoute} from './types';
const now=1795183200;
const route:HistoricalRoute={provider:'flyitalyadsb',callsign:'SIA214',origin:'YPPH',destination:'WSSS',origin_iata:'PER',destination_iata:'SIN',observed_count:7,last_seen_day:'2026-11-19',retrieved_at:now};
const aircraft=()=>({...observation(now),mode:'live' as const,callsign:'SIA214',lat:2,lon:103.9915,track_deg:180,route});
it('requires both matching historical route and current direction for Changi intent',()=>{
 const o=aircraft();
 expect(changiIntent(o,now)).toBe('inbound');
 expect(changiIntent({...o,track_deg:0},now)).toBe('unknown');
 expect(changiIntent({...o,track_deg:0,route:{...route,origin:'WSSS',destination:'YPPH'}},now)).toBe('outbound');
 expect(changiIntent({...o,route:{...route,origin:'WMKK',destination:'WADD'}},now)).toBe('unknown');
});
it('unknown, stale, taxiing, slow, missing-course and simulated aircraft never claim intent',()=>{
 const o=aircraft();
 for(const changed of [{ground:true},{ground:null},{speed_mps:0},{track_deg:null},{position_time:null},{position_time:now-21},{position_time:now+1},{mode:'simulated' as const},{lat:1.3644},{route:null}])
  expect(changiIntent({...o,...changed},now)).toBe('unknown');
});
it('rejects routes for another flight or expired/future evidence',()=>{
 const o=aircraft();
 for(const changed of [{callsign:'SIA215'},{last_seen_day:'2026-11-01'},{last_seen_day:'2026-11-21'},{retrieved_at:now-301},{retrieved_at:now+1}]){
  const altered={...o,route:{...route,...changed}};
  expect(routeFor(altered,now)).toBeNull();
  expect(changiIntent(altered,now)).toBe('unknown');
 }
});

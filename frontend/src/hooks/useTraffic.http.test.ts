// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {snapshot} from '../data/testHelpers';
vi.mock('../data/hosting',()=>({liveAvailable:true,httpFeedUrl:'https://cloud.example/api/aircraft',socketUrl:()=>null,fixtureUrl:()=>'/fixture'}));
import {useTraffic} from './useTraffic';
const frame=(sequence:number,epoch='cloud')=>{
  const f=snapshot(sequence,epoch,1700000000);
  f.mode='live';f.status.mode='live';f.scenario_time=null;
  for(const t of f.tracks) for(const o of [t.latest,...t.history])o.mode='live';
  return f;
};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1700000020000);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('keeps cached observation time honest and accepts a new cloud epoch',async()=>{
  const fetcher=vi.fn().mockImplementationOnce(async()=>new Response(JSON.stringify(frame(2))))
    .mockImplementationOnce(async()=>new Response(JSON.stringify(frame(2))))
    .mockImplementationOnce(async()=>new Response(JSON.stringify(frame(1,'restarted'))));
  vi.stubGlobal('fetch',fetcher);const {result}=renderHook(()=>useTraffic());
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(result.current.snapshot?.sequence).toBe(2);
  expect(result.current.getNow()).toBe(1700000020);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(result.current.getNow()).toBe(1700000035);
  expect(result.current.snapshot?.tracks[0].latest.position_time).toBe(1700000000);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(result.current.snapshot?.epoch).toBe('restarted');
  expect(result.current.transport).toBe('connected');
});
it.each([-120,120])('corrects device clock skew of %s seconds without changing positions',async(skew)=>{
  vi.setSystemTime((1700000000+skew)*1000);
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify(frame(1)),{headers:{'X-Response-Time':'1700000000','Age':'0'}})));
  const {result}=renderHook(()=>useTraffic());await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(result.current.getNow()).toBe(1700000000);
  expect(result.current.snapshot?.tracks[0].latest.position_time).toBe(1700000000);
});

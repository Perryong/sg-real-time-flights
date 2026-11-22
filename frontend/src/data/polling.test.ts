// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {startPolling} from './polling';
import {snapshot} from './testHelpers';
function frame(sequence=1,epoch='cloud') {
  const f=snapshot(sequence,epoch,1700000000);
  f.mode='live';f.status.mode='live';f.scenario_time=null;
  for(const t of f.tracks) for(const o of [t.latest,...t.history]) o.mode='live';
  return f;
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1700000000000);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('validates responses and waits between completed polls without overlapping requests',async()=>{
  let resolve:any;
  const fetcher=vi.fn(()=>new Promise(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);
  const seen=vi.fn();const state=vi.fn();const stop=startPolling('https://example.org/api/aircraft',seen,state);
  await vi.advanceTimersByTimeAsync(10000);expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(new Response(JSON.stringify(frame())));await vi.advanceTimersByTimeAsync(0);
  expect(seen).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(14999);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);
  stop();resolve(new Response(JSON.stringify(frame(2))));await vi.advanceTimersByTimeAsync(0);
  expect(seen).toHaveBeenCalledTimes(1);
});
it('honors Retry-After and never substitutes invalid or simulated responses',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'60'}}))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot())));
  vi.stubGlobal('fetch',fetcher);const seen=vi.fn();const state=vi.fn();const stop=startPolling('/api/aircraft',seen,state);
  await vi.advanceTimersByTimeAsync(59999);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(seen).not.toHaveBeenCalled();expect(state).toHaveBeenCalledWith('unavailable');stop();
});
it('pauses hidden tabs and immediately resumes once, without duplicate timers',async()=>{
  const visibility=vi.spyOn(document,'visibilityState','get');
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(frame())));vi.stubGlobal('fetch',fetcher);
  const stop=startPolling('/api/aircraft',vi.fn(),vi.fn());await vi.advanceTimersByTimeAsync(0);
  visibility.mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120000);expect(fetcher).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(2);stop();
});
it('retains rate-limit backoff when switching tabs',async()=>{
  const visibility=vi.spyOn(document,'visibilityState','get');
  const fetcher=vi.fn().mockImplementation(async()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}}));
  vi.stubGlobal('fetch',fetcher);const stop=startPolling('/api/aircraft',vi.fn(),vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  visibility.mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(10000);
  visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(49999);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);stop();
});
it('passes the response clock plus CDN age without changing collection time',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify(frame()),{headers:{'X-Response-Time':'1700000010','Age':'5'}})));
  const seen=vi.fn();const stop=startPolling('/api/aircraft',seen,vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(seen.mock.calls[0][0].server_time).toBe(1700000000);
  expect(seen.mock.calls[0][1]).toBe(1700000015);stop();
});

// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {startWeatherPolling} from './weatherPolling';
const payload={layer:'wind',state:'fresh',observed_at:1700000000,fetched_at:1700000000,retry_after:60,message:null,stations:[]};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1700000000000);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
it('polls only its requested layer at the cadence and ignores disposed responses',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(payload)));vi.stubGlobal('fetch',fetcher);
 const seen=vi.fn(),stop=startWeatherPolling('/api/weather','wind',{notBefore:0},seen);
 await vi.advanceTimersByTimeAsync(0);expect(fetcher.mock.calls[0][0]).toBe('/api/weather?layer=wind');expect(seen.mock.calls.at(-1)?.[0].phase).toBe('ready');
 await vi.advanceTimersByTimeAsync(59999);expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);
 stop();await vi.advanceTimersByTimeAsync(120000);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('retains Retry-After through hidden tabs and toggle remounts',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response('{}',{status:429,headers:{'Retry-After':'300'}}));vi.stubGlobal('fetch',fetcher);
 const gate={notBefore:0},seen=vi.fn();let stop=startWeatherPolling('/api/weather','wind',gate,seen);
 await vi.advanceTimersByTimeAsync(0);stop();
 stop=startWeatherPolling('/api/weather','wind',gate,seen);await vi.advanceTimersByTimeAsync(299999);expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);stop();
});
it('pauses hidden requests and resumes without overlap',async()=>{
 const visibility=vi.spyOn(document,'visibilityState','get');visibility.mockReturnValue('hidden');
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(payload)));vi.stubGlobal('fetch',fetcher);
 const stop=startWeatherPolling('/api/weather','wind',{notBefore:0},vi.fn());await vi.advanceTimersByTimeAsync(120000);expect(fetcher).not.toHaveBeenCalled();
 visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(1);stop();
});
it('rejects wrong-layer payloads and aborts late results on disposal',async()=>{
 let resolve:(value:Response)=>void=()=>{};
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r})));const seen=vi.fn();
 const stop=startWeatherPolling('/api/weather','radar',{notBefore:0},seen);stop();resolve(new Response(JSON.stringify(payload)));await vi.advanceTimersByTimeAsync(0);
 expect(seen.mock.calls.some(c=>c[0].phase==='ready')).toBe(false);
});
it('reserves cadence before an in-flight request is toggled off',async()=>{
 const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetcher);
 const gate={notBefore:0};const stop=startWeatherPolling('/api/weather','wind',gate,vi.fn());stop();
 const stopAgain=startWeatherPolling('/api/weather','wind',gate,vi.fn());
 await vi.advanceTimersByTimeAsync(59999);expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(2);stopAgain();
});
it('caps timer sleeps for monthly Retry-After without shortening the gate',()=>{
 vi.stubGlobal('fetch',vi.fn());const spy=vi.spyOn(globalThis,'setTimeout');
 const gate={notBefore:Date.now()+31*86400000};const stop=startWeatherPolling('/api/weather','wind',gate,vi.fn());
 expect(spy.mock.calls.at(-1)?.[1]).toBe(2147483647);expect(gate.notBefore).toBe(Date.now()+31*86400000);stop();
});

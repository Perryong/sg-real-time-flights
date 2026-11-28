// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useWeatherLayer} from './useWeather';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
it('retains the known request-limit error when re-enabled during the regional retry delay',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const fetcher=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'900'}}));vi.stubGlobal('fetch',fetcher);
 const hook=renderHook(({enabled})=>useWeatherLayer('wind_regional',enabled),{initialProps:{enabled:true}});
 await act(()=>vi.advanceTimersByTimeAsync(0));expect(hook.result.current.phase).toBe('error');
 hook.rerender({enabled:false});expect(hook.result.current.phase).toBe('off');
 hook.rerender({enabled:true});await act(()=>vi.advanceTimersByTimeAsync(0));
 expect(hook.result.current.phase).toBe('error');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('shows a waiting state rather than loading when an interrupted request is gated',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));
 const hook=renderHook(({enabled})=>useWeatherLayer('wind_regional',enabled),{initialProps:{enabled:true}});
 hook.rerender({enabled:false});hook.rerender({enabled:true});
 expect(hook.result.current).toEqual({phase:'paused',message:'Waiting for the next scheduled weather check.'});
});
it('keeps a truthful waiting state after a hidden tab resumes inside a retry delay',async()=>{
 vi.useFakeTimers();const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const fetcher=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'900'}}));vi.stubGlobal('fetch',fetcher);
 const hook=renderHook(()=>useWeatherLayer('wind_regional',true));await act(()=>vi.advanceTimersByTimeAsync(0));
 act(()=>{visibility.mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'))});
 act(()=>{visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'))});
 expect(hook.result.current.phase).toBe('paused');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains dated Changi data on refresh failure and stops checks while closed',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const now=Date.now()/1000;
 const payload={layer:'changi_outlook',state:'fresh',observed_at:now,fetched_at:now,retry_after:900,message:null,source:'Open-Meteo',
  location:{name:'Changi Airport',lat:1.3644,lon:103.9915},current:{humidity_pct:0,pressure_msl_hpa:1005},daily:[]};
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(payload)).mockResolvedValueOnce(new Response('{}',{status:503}));
 vi.stubGlobal('fetch',fetcher);
 const hook=renderHook(({enabled})=>useWeatherLayer('changi_outlook',enabled),{initialProps:{enabled:true}});
 await act(()=>vi.advanceTimersByTimeAsync(0));expect(hook.result.current).toMatchObject({phase:'ready',data:payload});
 await act(()=>vi.advanceTimersByTimeAsync(900000));expect(hook.result.current).toMatchObject({phase:'error',cached:payload});
 hook.rerender({enabled:false});
 await act(()=>vi.advanceTimersByTimeAsync(1800000));
 expect(hook.result.current.phase).toBe('off');expect(fetcher).toHaveBeenCalledTimes(2);
});

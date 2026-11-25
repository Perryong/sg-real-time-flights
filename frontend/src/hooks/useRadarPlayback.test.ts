// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useRadarPlayback} from './useRadarPlayback';
import type {RadarHistoryWeather} from '../data/weather';
const state=vi.hoisted(()=>({load:{} as unknown}));
vi.mock('./useWeather',()=>({useWeatherLayer:()=>state.load}));
const now=1800000000;
const frames=[0,1,2].map(i=>({url:`https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/${i}.png`,west:99.638609,east:108.290871,south:-2.967382,north:5.657912,observed_at:now-3600+i*300,expires_at:now+3600}));
const history:RadarHistoryWeather={layer:'radar_history',range_km:480,expected_frames:13,window_start:now-3600,window_end:now,state:'fresh',observed_at:frames[2].observed_at,fetched_at:now,retry_after:300,message:null,frames};
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');state.load={phase:'ready',data:history}});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers()});
it('starts paused, advances only after displayed acknowledgement, and returns to current radar',()=>{
 const live={...frames[0],observed_at:now,url:frames[0].url+'?live'};
 const h=renderHook(()=>useRadarPlayback(true,live,now));expect(h.result.current.mode).toBe('live');
 act(()=>h.result.current.enter());expect(h.result.current.mode).toBe('history');expect(h.result.current.frame).toEqual(frames[0]);expect(h.result.current.playing).toBe(false);
 act(()=>h.result.current.onReady(frames[0].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>vi.advanceTimersByTime(2000));expect(h.result.current.frame).toEqual(frames[1]);
 act(()=>vi.advanceTimersByTime(10000));expect(h.result.current.frame).toEqual(frames[1]);
 act(()=>h.result.current.onReady(frames[1].observed_at));act(()=>vi.advanceTimersByTime(2000));expect(h.result.current.frame).toEqual(frames[2]);
 act(()=>h.result.current.returnLive());expect(h.result.current.frame).toEqual(live);expect(h.result.current.playing).toBe(false);
 expect(h.result.current.showHistoryBanner).toBe(true);
 act(()=>h.result.current.onReady(live.observed_at));expect(h.result.current.showHistoryBanner).toBe(false);
});
it('seeking pauses and hidden tabs stop playback',()=>{
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const h=renderHook(()=>useRadarPlayback(true,null,now));act(()=>h.result.current.enter());act(()=>h.result.current.onReady(frames[0].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>h.result.current.seek(2));expect(h.result.current.frame).toEqual(frames[2]);expect(h.result.current.playing).toBe(false);
 act(()=>h.result.current.onReady(frames[2].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>{visibility.mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'))});expect(h.result.current.playing).toBe(false);
});
it('resets on disable and hides expired frames',()=>{
 const h=renderHook(({enabled,time})=>useRadarPlayback(enabled,null,time),{initialProps:{enabled:true,time:now}});
 act(()=>h.result.current.enter());h.rerender({enabled:false,time:now});expect(h.result.current.mode).toBe('live');expect(h.result.current.frame).toBeNull();
 h.rerender({enabled:true,time:now+3601});act(()=>h.result.current.enter());expect(h.result.current.frames).toHaveLength(0);expect(h.result.current.frame).toBeNull();
});
it('stops on image failure and can seek to a different frame',()=>{
 const h=renderHook(()=>useRadarPlayback(true,null,now));act(()=>h.result.current.enter());act(()=>h.result.current.onReady(frames[0].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>h.result.current.onError());expect(h.result.current.playing).toBe(false);expect(h.result.current.frame).toBeNull();expect(h.result.current.imageError).toBe(true);
 act(()=>h.result.current.seek(1));expect(h.result.current.frame).toEqual(frames[1]);expect(h.result.current.imageError).toBe(false);
});

it('allows pausing while the next frame is loading',()=>{
 const h=renderHook(()=>useRadarPlayback(true,null,now));act(()=>h.result.current.enter());act(()=>h.result.current.onReady(frames[0].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>vi.advanceTimersByTime(2000));expect(h.result.current.loaded).toBe(false);
 act(()=>h.result.current.togglePlay());expect(h.result.current.playing).toBe(false);
 act(()=>h.result.current.onReady(frames[1].observed_at));act(()=>vi.advanceTimersByTime(4000));expect(h.result.current.frame).toEqual(frames[1]);
});
it('loops actual frames and pauses when a rolling window drops the selection',()=>{
 const h=renderHook(()=>useRadarPlayback(true,null,now));act(()=>h.result.current.enter());act(()=>h.result.current.seek(2));act(()=>h.result.current.onReady(frames[2].observed_at));act(()=>h.result.current.togglePlay());
 act(()=>vi.advanceTimersByTime(2000));expect(h.result.current.frame).toEqual(frames[0]);
 state.load={phase:'ready',data:{...history,frames:frames.slice(1)}};h.rerender();expect(h.result.current.frame).toEqual(frames[1]);expect(h.result.current.playing).toBe(false);
});

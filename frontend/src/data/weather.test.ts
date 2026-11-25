import {expect,it} from 'vitest';
import {parseWeather,weatherCurrent} from './weather';
const now=1800000000;
const wind={layer:'wind',state:'fresh',observed_at:now-60,fetched_at:now,retry_after:60,message:null,stations:[{id:'S1',name:'Changi',lat:1.36,lon:103.99,speed_mps:2,from_deg:90}]};
const radar={layer:'radar',state:'fresh',observed_at:now-300,fetched_at:now,retry_after:300,message:null,radar:{url:'https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/test.png',west:103.34,south:.72,east:104.6,north:1.98,observed_at:now-300,expires_at:now+600}};
it('accepts independently typed wind and radar observations',()=>{
 expect(parseWeather(wind,'wind')).toEqual(wind);expect(parseWeather(radar,'radar')).toEqual(radar);
 expect(parseWeather(wind,'radar')).toBeNull();
});
it('rejects invalid observations instead of manufacturing calm or clear weather',()=>{
 for(const bad of [null,{...wind,stations:[{...wind.stations[0],speed_mps:null}]},{...wind,stations:[{...wind.stations[0],from_deg:361}]},{...wind,observed_at:'today'}])expect(parseWeather(bad,'wind')).toBeNull();
 expect(parseWeather({...radar,radar:{...radar.radar,url:'http://example.org/a.png'}},'radar')).toBeNull();
 expect(parseWeather({...radar,radar:{...radar.radar,east:102}},'radar')).toBeNull();
});
it('does not show stale, future or expired weather as current',()=>{
 const w=parseWeather(wind,'wind')!,r=parseWeather(radar,'radar')!;
 expect(weatherCurrent(w,now)).toBe(true);expect(weatherCurrent(w,now+601)).toBe(false);
 expect(weatherCurrent(r,now+601)).toBe(false);expect(weatherCurrent(w,now-200)).toBe(false);
 expect(weatherCurrent({...w,state:'stale'},now)).toBe(false);
});
const regional={layer:'wind_regional',kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,state:'fresh',observed_at:now-900,fetched_at:now,retry_after:900,message:null,points:[{id:'grid-1',lat:3,lon:103,speed_mps:4,from_deg:180}]};
const wide={...radar,layer:'radar_wide',range_km:480,radar:{...radar.radar,west:99.638609,east:108.290871,south:-2.967382,north:5.657912}};
it('accepts explicitly modelled regional wind and keeps stations distinct',()=>{
 expect(parseWeather(regional,'wind_regional')).toEqual(regional);
 for(const bad of [{...regional,kind:'observed'},{...regional,height_m:1000},{...regional,coverage_km:700},{...regional,points:undefined,stations:wind.stations},{...regional,points:[{...regional.points[0],speed_mps:null}]},{...regional,points:[{...regional.points[0],lat:20}]},{...regional,points:[regional.points[0],regional.points[0]]}])expect(parseWeather(bad,'wind_regional')).toBeNull();
 expect(parseWeather(regional,'wind')).toBeNull();
});
it('accepts 480 km bounds but rejects a relabelled 70 km image',()=>{
 expect(parseWeather(wide,'radar_wide')).toEqual(wide);
 expect(parseWeather({...wide,range_km:70},'radar_wide')).toBeNull();
 expect(parseWeather({...wide,radar:radar.radar},'radar_wide')).toBeNull();
 expect(parseWeather({...wide,radar:{...wide.radar,observed_at:now}},'radar_wide')).toBeNull();
});
it('uses model valid time with a 30 minute freshness limit and requires usable points',()=>{
 const model=parseWeather(regional,'wind_regional');expect(model).not.toBeNull();
 if(!model)throw Error('Expected regional weather');
 expect(weatherCurrent(model,now)).toBe(true);expect(weatherCurrent(model,now+901)).toBe(false);
 expect(weatherCurrent({...model,observed_at:now+31},now)).toBe(false);
 const empty=parseWeather({...regional,points:[]},'wind_regional');expect(empty&&weatherCurrent(empty,now)).toBe(false);
});
const history={layer:'radar_history',range_km:480,window_start:now-3600,window_end:now,expected_frames:13,state:'fresh',observed_at:now-300,fetched_at:now,retry_after:300,message:null,frames:[{...wide.radar,observed_at:now-3600},{...wide.radar,url:wide.radar.url+'?frame=2',observed_at:now-300}]};
it('accepts historical frames older than the live freshness limit without filling gaps',()=>{
 const parsed=parseWeather(history,'radar_history');expect(parsed).toEqual(history);
 expect(parsed&&weatherCurrent(parsed,now)).toBe(true);
 expect(parsed&&weatherCurrent(parsed,now+901)).toBe(false);
});
it('rejects duplicate, unordered, out-of-window and relabelled history images',()=>{
 for(const bad of [{...history,frames:[history.frames[1],history.frames[0]]},{...history,frames:[history.frames[0],history.frames[0]]},{...history,frames:[{...history.frames[0],observed_at:now-3900}]},{...history,frames:[radar.radar]},{...history,window_start:now-7200},{...history,expected_frames:25}])expect(parseWeather(bad,'radar_history')).toBeNull();
});
it('does not expose expired history or unavailable snapshots as playable',()=>{
 const expired=parseWeather({...history,frames:history.frames.map(f=>({...f,expires_at:now-1}))},'radar_history');
 expect(expired&&weatherCurrent(expired,now)).toBe(false);
 const unavailable=parseWeather({...history,state:'unavailable'},'radar_history');expect(unavailable&&weatherCurrent(unavailable,now)).toBe(false);
});

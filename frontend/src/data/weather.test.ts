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

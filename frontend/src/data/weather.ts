import {regions} from './regions';

export type WeatherLayer = 'wind' | 'radar' | 'wind_regional' | 'radar_wide' | 'radar_history' | 'changi_outlook';
export interface WeatherEnvelope {
 state:'fresh'|'stale'|'unavailable';
 /** Observation time for measured feeds; valid time for the explicitly modelled feed. */
 observed_at:number|null;
 fetched_at:number|null;retry_after:number;message:string|null;
}
export interface WindPoint {id:string;lat:number;lon:number;speed_mps:number;from_deg:number}
export interface WindStation extends WindPoint {name:string}
export interface RadarFrame {url:string;west:number;south:number;east:number;north:number;observed_at:number;expires_at:number}
export interface WindWeather extends WeatherEnvelope {layer:'wind';stations:WindStation[]}
export interface RegionalWindWeather extends WeatherEnvelope {layer:'wind_regional';kind:'model';source:'Open-Meteo';height_m:10;coverage_km:500;points:WindPoint[]}
export interface RadarWeather extends WeatherEnvelope {layer:'radar';radar:RadarFrame|null}
export interface WideRadarWeather extends WeatherEnvelope {layer:'radar_wide';range_km:480;radar:RadarFrame|null}
export interface RadarHistoryWeather extends WeatherEnvelope {layer:'radar_history';range_km:480;window_start:number;window_end:number;expected_frames:13;frames:RadarFrame[]}
const changiAirport={name:'Changi Airport',lat:1.3644,lon:103.9915} as const;
export interface ChangiForecastDay {date:string;weather_code:number|null;low_c:number|null;high_c:number|null}
export interface ChangiOutlookWeather extends WeatherEnvelope {
 layer:'changi_outlook';source:'Open-Meteo';location:typeof changiAirport;
 current:{humidity_pct:number|null;pressure_msl_hpa:number|null};
 daily:ChangiForecastDay[];
}
export type WeatherData = WindWeather | RegionalWindWeather | RadarWeather | WideRadarWeather | RadarHistoryWeather | ChangiOutlookWeather;

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const timestamp=(v:unknown):v is number|null=>v===null||(finite(v)&&v>=0);
const weatherCodes:Readonly<Record<number,string>>={
 0:'Clear sky',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',
 51:'Light drizzle',53:'Moderate drizzle',55:'Heavy drizzle',56:'Light freezing drizzle',57:'Heavy freezing drizzle',
 61:'Light rain',63:'Moderate rain',65:'Heavy rain',66:'Light freezing rain',67:'Heavy freezing rain',
 71:'Light snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',
 80:'Light rain showers',81:'Moderate rain showers',82:'Very heavy rain showers',85:'Light snow showers',86:'Heavy snow showers',
 95:'Thunderstorm',96:'Thunderstorm with light hail',97:'Heavy thunderstorm',99:'Thunderstorm with heavy hail',
};
export const weatherCodeLabel=(code:number|null)=>code===null?null:weatherCodes[code]??null;
const range=(value:unknown,min:number,max:number)=>finite(value)&&value>=min&&value<=max?value:null;
function dateKey(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function parseChangiOutlook(value:Record<string,unknown>,envelope:WeatherEnvelope):ChangiOutlookWeather|null {
 const {location,source}=value;
 if(!record(location)||location.name!==changiAirport.name||location.lat!==changiAirport.lat||location.lon!==changiAirport.lon||source!=='Open-Meteo')return null;
 const current=record(value.current)?value.current:{};
 const daily=new Map<string,ChangiForecastDay>();
 if(Array.isArray(value.daily))for(const day of value.daily){
  if(!record(day)||!dateKey(day.date)||daily.has(day.date))continue;
  const weather_code=finite(day.weather_code)&&weatherCodeLabel(day.weather_code)?day.weather_code:null;
  const low=range(day.low_c,-100,70),high=range(day.high_c,-100,70);
  const inverted=low!==null&&high!==null&&low>high;
  daily.set(day.date,{date:day.date,weather_code,low_c:inverted?null:low,high_c:inverted?null:high});
 }
 return {layer:'changi_outlook',...envelope,source,location:changiAirport,
  observed_at:range(envelope.observed_at,0,8.64e12),fetched_at:range(envelope.fetched_at,0,8.64e12),
  current:{humidity_pct:range(current.humidity_pct,0,100),pressure_msl_hpa:range(current.pressure_msl_hpa,850,1100)},daily:[...daily.values()]};
}
export function changiForecastDates(now:number):string[] {
 const singaporeDay=Math.floor((now+8*3600)/86400);
 return Array.from({length:5},(_,index)=>new Date((singaporeDay+index+1)*86400000).toISOString().slice(0,10));
}
function outlookAge(at:number|null,now:number,staleAfter:number,expireAfter:number):WeatherEnvelope['state'] {
 if(at===null||at>now+30||now-at>expireAfter)return 'unavailable';
 return now-at>staleAfter?'stale':'fresh';
}
export function outlookFreshness(data:ChangiOutlookWeather|undefined,now:number){
 return {current:outlookAge(data?.observed_at??null,now,1800,3600),forecast:outlookAge(data?.fetched_at??null,now,3600,21600)};
}
function parsePoint(value:unknown):WindPoint|null {
 if(!record(value))return null;
 const {id,lat,lon,speed_mps,from_deg}=value;
 if(typeof id!=='string'||!id||!finite(lat)||Math.abs(lat)>90||!finite(lon)||Math.abs(lon)>180||!finite(speed_mps)||speed_mps<0||speed_mps>103||!finite(from_deg)||from_deg<0||from_deg>360)return null;
 return {id,lat,lon,speed_mps,from_deg};
}
function inRegionalCoverage(point:WindPoint):boolean {
 const rad=Math.PI/180,center=regions.singapore;
 const a=Math.sin((point.lat-center.lat)*rad/2)**2+Math.cos(center.lat*rad)*Math.cos(point.lat*rad)*Math.sin((point.lon-center.lon)*rad/2)**2;
 // The server checks each returned cell against its grid and 500km radius.
 // This boundary guard rejects clearly out-of-region payloads.
 return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,a)))<=505;
}
function parseRadar(value:unknown):RadarFrame|null|undefined {
 if(value===null)return null;
 if(!record(value))return undefined;
 const {url,west,south,east,north,observed_at,expires_at}=value;
 if(typeof url!=='string'||url.length>16384||!finite(west)||!finite(east)||!finite(south)||!finite(north)||west>=east||south>=north||west< -180||east>180||south< -90||north>90||!finite(observed_at)||!finite(expires_at)||observed_at<0||expires_at<=observed_at)return undefined;
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hostname!=='dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com'||(parsed.port&&parsed.port!=='443')||parsed.hash||!parsed.pathname.endsWith('.png'))return undefined;
 }catch{return undefined}
 return {url,west,south,east,north,observed_at,expires_at};
}
const wideBounds=(radar:RadarFrame)=>Math.abs(radar.west-99.638609)<=.05&&Math.abs(radar.east-108.290871)<=.05&&Math.abs(radar.south+2.967382)<=.05&&Math.abs(radar.north-5.657912)<=.05;
export function historyFrames(data:RadarHistoryWeather,now:number):RadarFrame[]{
 if(data.state==='unavailable'||data.fetched_at===null||now-data.fetched_at>900||data.fetched_at>now+30||now-data.window_end>900||data.window_end>now+30)return [];
 return data.frames.filter(frame=>frame.expires_at>now+10);
}
export function parseWeather(value:unknown,layer:WeatherLayer):WeatherData|null {
 if(!record(value)||value.layer!==layer)return null;
 const {state,observed_at,fetched_at,retry_after,message}=value;
 if((state!=='fresh'&&state!=='stale'&&state!=='unavailable')||!timestamp(observed_at)||!timestamp(fetched_at)||!finite(retry_after)||retry_after<0||retry_after>86400||(message!==null&&typeof message!=='string'))return null;
 const envelope:WeatherEnvelope={state,observed_at,fetched_at,retry_after,message};
 if(layer==='changi_outlook')return parseChangiOutlook(value,envelope);
 if(layer==='wind'){
  if(!Array.isArray(value.stations)||value.stations.length>256)return null;
  const stations:WindStation[]=[];
  for(const station of value.stations){
   const point=parsePoint(station);
   if(!point||!record(station)||typeof station.name!=='string')return null;
   stations.push({...point,name:station.name});
  }
  return {layer,...envelope,stations};
 }
 if(layer==='wind_regional'){
  if(value.kind!=='model'||value.source!=='Open-Meteo'||value.height_m!==10||value.coverage_km!==500||!Array.isArray(value.points)||value.points.length>81)return null;
  const points:WindPoint[]=[],ids=new Set<string>();
  for(const raw of value.points){
   const point=parsePoint(raw);
   if(!point||!inRegionalCoverage(point)||ids.has(point.id))return null;
   ids.add(point.id);points.push(point);
  }
  return {layer,...envelope,kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points};
 }
 if(layer==='radar_history'){
  const {window_start,window_end,expected_frames}=value;
  if(value.range_km!==480||expected_frames!==13||!finite(window_start)||!finite(window_end)||window_start<0||window_end-window_start!==3600||window_end%300!==0||!Array.isArray(value.frames)||value.frames.length>13)return null;
  const frames:RadarFrame[]=[];
  for(const raw of value.frames){
   const frame=parseRadar(raw);
   if(!frame||!wideBounds(frame)||frame.observed_at<window_start||frame.observed_at>window_end||(frames.length>0&&frame.observed_at<=frames[frames.length-1].observed_at))return null;
   frames.push(frame);
  }
  if(observed_at!==(frames.at(-1)?.observed_at??null))return null;
  return {layer,...envelope,range_km:480,window_start,window_end,expected_frames:13,frames};
 }
 const radar=parseRadar(value.radar);
 if(radar===undefined||radar&&radar.observed_at!==observed_at)return null;
 if(layer==='radar_wide'){
  if(value.range_km!==480)return null;
  if(radar&&!wideBounds(radar))return null;
  return {layer,...envelope,range_km:480,radar};
 }
 return {layer,...envelope,radar};
}
export function weatherCurrent(data:WeatherData,now:number):boolean {
 if(data.layer==='radar_history')return historyFrames(data,now).length>0;
 if(data.layer==='changi_outlook'){
  const freshness=outlookFreshness(data,now);
  return freshness.current!=='unavailable'||freshness.forecast!=='unavailable';
 }
 const age=data.observed_at===null?Infinity:now-data.observed_at;
 const maxAge=data.layer==='wind'?600:data.layer==='wind_regional'?1800:900;
 if(data.state!=='fresh'||age< -30||age>maxAge)return false;
 if(data.layer==='wind')return data.stations.length>0;
 if(data.layer==='wind_regional')return data.points.length>0;
 return !!data.radar&&data.radar.expires_at>now+10;
}

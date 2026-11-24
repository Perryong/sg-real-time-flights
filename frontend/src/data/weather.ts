import {regions} from './regions';

export type WeatherLayer = 'wind' | 'radar' | 'wind_regional' | 'radar_wide';
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
export type WeatherData = WindWeather | RegionalWindWeather | RadarWeather | WideRadarWeather;

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const timestamp=(v:unknown):v is number|null=>v===null||(finite(v)&&v>=0);
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
export function parseWeather(value:unknown,layer:WeatherLayer):WeatherData|null {
 if(!record(value)||value.layer!==layer)return null;
 const {state,observed_at,fetched_at,retry_after,message}=value;
 if((state!=='fresh'&&state!=='stale'&&state!=='unavailable')||!timestamp(observed_at)||!timestamp(fetched_at)||!finite(retry_after)||retry_after<0||retry_after>86400||(message!==null&&typeof message!=='string'))return null;
 const envelope:WeatherEnvelope={state,observed_at,fetched_at,retry_after,message};
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
 const radar=parseRadar(value.radar);
 if(radar===undefined||radar&&radar.observed_at!==observed_at)return null;
 if(layer==='radar_wide'){
  if(value.range_km!==480)return null;
  if(radar&&(Math.abs(radar.west-99.638609)>.05||Math.abs(radar.east-108.290871)>.05||Math.abs(radar.south+2.967382)>.05||Math.abs(radar.north-5.657912)>.05))return null;
  return {layer,...envelope,range_km:480,radar};
 }
 return {layer,...envelope,radar};
}
export function weatherCurrent(data:WeatherData,now:number):boolean {
 const age=data.observed_at===null?Infinity:now-data.observed_at;
 const maxAge=data.layer==='wind'?600:data.layer==='wind_regional'?1800:900;
 if(data.state!=='fresh'||age< -30||age>maxAge)return false;
 if(data.layer==='wind')return data.stations.length>0;
 if(data.layer==='wind_regional')return data.points.length>0;
 return !!data.radar&&data.radar.expires_at>now+10;
}

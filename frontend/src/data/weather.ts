export type WeatherLayer = 'wind' | 'radar';
export interface WeatherEnvelope {state:'fresh'|'stale'|'unavailable';observed_at:number|null;fetched_at:number|null;retry_after:number;message:string|null}
export interface WindStation {id:string;name:string;lat:number;lon:number;speed_mps:number;from_deg:number}
export interface RadarFrame {url:string;west:number;south:number;east:number;north:number;observed_at:number;expires_at:number}
export interface WindWeather extends WeatherEnvelope {layer:'wind';stations:WindStation[]}
export interface RadarWeather extends WeatherEnvelope {layer:'radar';radar:RadarFrame|null}
export type WeatherData = WindWeather | RadarWeather;

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const timestamp=(v:unknown):v is number|null=>v===null||(finite(v)&&v>=0);
export function parseWeather(value:unknown,layer:WeatherLayer):WeatherData|null {
 if(!record(value)||value.layer!==layer||!['fresh','stale','unavailable'].includes(String(value.state)))return null;
 const {state,observed_at,fetched_at,retry_after,message}=value;
 if((state!=='fresh'&&state!=='stale'&&state!=='unavailable')||!timestamp(observed_at)||!timestamp(fetched_at)||!finite(retry_after)||retry_after<0||retry_after>86400||(message!==null&&typeof message!=='string'))return null;
 const envelope:WeatherEnvelope={state,observed_at,fetched_at,retry_after,message};
 if(layer==='wind'){
  if(!Array.isArray(value.stations)||value.stations.length>256)return null;
  const stations:WindStation[]=[];
  for(const point of value.stations){
   if(!record(point))return null;
   const {id,name,lat,lon,speed_mps,from_deg}=point;
   if(typeof id!=='string'||typeof name!=='string'||!finite(lat)||Math.abs(lat)>90||!finite(lon)||Math.abs(lon)>180||!finite(speed_mps)||speed_mps<0||speed_mps>100||!finite(from_deg)||from_deg<0||from_deg>360)return null;
   stations.push({id,name,lat,lon,speed_mps,from_deg});
  }
  return {layer,...envelope,stations};
 }
 if(value.radar===null)return {layer,...envelope,radar:null};
 if(!record(value.radar))return null;
 const {url,west,south,east,north,observed_at:at,expires_at}=value.radar;
 if(typeof url!=='string'||url.length>16384||!finite(west)||!finite(east)||!finite(south)||!finite(north)||west>=east||south>=north||west< -180||east>180||south< -90||north>90||!finite(at)||!finite(expires_at)||at<0||expires_at<=at)return null;
 try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hostname!=='dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com')return null}catch{return null}
 return {layer,...envelope,radar:{url,west,south,east,north,observed_at:at,expires_at}};
}
export function weatherCurrent(data:WeatherData,now:number):boolean {
 const age=data.observed_at===null?Infinity:now-data.observed_at;
 return data.state==='fresh'&&age>=-30&&age<=(data.layer==='wind'?600:900)&&
  (data.layer==='wind'?data.stations.length>0:!!data.radar&&data.radar.expires_at>now+10);
}

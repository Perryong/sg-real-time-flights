import {parseWeather,type WeatherData,type WeatherLayer} from './weather';
export type WeatherLoad={phase:'ready';data:WeatherData}|{phase:'off'|'loading'|'error'|'paused';message:string};
export interface WeatherGate {notBefore:number}
/** One bounded request per enabled layer; the gate survives toggle changes. */
export function startWeatherPolling(base:string,layer:WeatherLayer,gate:WeatherGate,onState:(state:WeatherLoad)=>void){
 const interval=layer==='wind'?60000:layer==='wind_regional'?900000:300000;
 let stopped=false,pending=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 const hidden=()=>document.visibilityState==='hidden';
 const schedule=()=>{clearTimeout(timer);if(!stopped&&!hidden())timer=setTimeout(poll,Math.min(2147483647,Math.max(0,gate.notBefore-Date.now())))};
 const poll=async()=>{
  if(stopped||pending||hidden())return;
  if(Date.now()<gate.notBefore){schedule();return}
  gate.notBefore=Date.now()+interval;
  pending=true;const request=new AbortController();controller=request;
  const deadline=setTimeout(()=>request.abort('timeout'),15000);
  let delay=interval;
  try{
   const response=await fetch(`${base}?layer=${layer}`,{signal:request.signal,credentials:'omit',cache:'no-store'});
   if(!response.ok){
    const retry=Number(response.headers.get('Retry-After'));
    delay=Math.max(interval,Number.isFinite(retry)&&retry>0?retry*1000:60000);
    throw Error(response.status===429?'Weather request limit reached. Retrying later.':response.status===403?'Weather access unavailable.':'Weather temporarily unavailable.');
   }
   const data=parseWeather(await response.json(),layer);
   if(!data)throw Error('Weather response unavailable.');
   delay=Math.max(interval,data.retry_after*1000);
   if(!stopped&&!request.signal.aborted)onState({phase:'ready',data});
  }catch(error){
   if(request.signal.reason!=='hidden'&&request.signal.reason!=='disposed'){
    delay=Math.max(delay,60000);
    if(!stopped)onState({phase:'error',message:error instanceof Error&&!request.signal.aborted?error.message:'Weather request timed out.'});
   }
  }finally{
   clearTimeout(deadline);pending=false;
   if(request.signal.reason!=='hidden'&&request.signal.reason!=='disposed')gate.notBefore=Date.now()+delay;
   schedule();
  }
 };
 const visibility=()=>{
  clearTimeout(timer);
  if(hidden()){controller?.abort('hidden');onState({phase:'paused',message:'Weather updates paused while this tab is hidden.'})}
  else if(!pending){onState({phase:'loading',message:'Loading weather…'});schedule()}
 };
 document.addEventListener('visibilitychange',visibility);
 onState({phase:'loading',message:'Loading weather…'});void poll();
 return ()=>{stopped=true;clearTimeout(timer);controller?.abort('disposed');document.removeEventListener('visibilitychange',visibility)};
}

import {parseWeather,type ChangiOutlookWeather,type WeatherData,type WeatherLayer} from './weather';
export type WeatherLoad={phase:'ready';data:WeatherData}|{phase:'off'|'loading'|'paused';message:string}|{phase:'error';message:string;cached?:ChangiOutlookWeather};
export interface WeatherGate {notBefore:number;awaitingProvider?:boolean}
/** One bounded request per enabled layer; the gate survives toggle changes. */
export function startWeatherPolling(base:string,layer:WeatherLayer,gate:WeatherGate,onState:(state:WeatherLoad)=>void){
 const outlook=layer==='changi_outlook';
 const outlookRecheck=15000;
 const interval=layer==='wind'?60000:layer==='wind_regional'||outlook?900000:300000;
 const loading:WeatherLoad={phase:'loading',message:'Loading weather…'};
 let stopped=false,pending=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 const hidden=()=>document.visibilityState==='hidden';
 const schedule=()=>{clearTimeout(timer);if(!stopped&&!hidden())timer=setTimeout(poll,Math.min(2147483647,Math.max(0,gate.notBefore-Date.now())))};
 const poll=async()=>{
  if(stopped||pending||hidden())return;
  if(Date.now()<gate.notBefore){schedule();return}
  gate.notBefore=Date.now()+(outlook?outlookRecheck:interval);
  if(outlook)gate.awaitingProvider=true;
  pending=true;const request=new AbortController();controller=request;
  const deadline=setTimeout(()=>request.abort('timeout'),15000);
  let delay=interval,awaitingProvider=false;
  try{
   const response=await fetch(`${base}?layer=${layer}`,{signal:request.signal,credentials:'omit',cache:'no-store'});
   if(outlook&&response.status===202){
    delay=outlookRecheck;awaitingProvider=true;
    return;
   }
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
   if(request.signal.reason!=='hidden'&&request.signal.reason!=='disposed'){
    gate.notBefore=Date.now()+delay;
    if(outlook)gate.awaitingProvider=awaitingProvider;
    if(!stopped&&awaitingProvider)onState(loading);
   }
   schedule();
  }
 };
 const visibility=()=>{
  clearTimeout(timer);
  if(hidden()){controller?.abort('hidden');onState({phase:'paused',message:'Weather updates paused while this tab is hidden.'})}
  else if(!pending){onState(loading);schedule()}
 };
 document.addEventListener('visibilitychange',visibility);
 onState(loading);void poll();
 return ()=>{stopped=true;clearTimeout(timer);controller?.abort('disposed');document.removeEventListener('visibilitychange',visibility)};
}

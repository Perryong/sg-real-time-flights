import {useEffect,useRef,useState} from 'react';
import {weatherUrl} from '../data/hosting';
import {startWeatherPolling,type WeatherLoad} from '../data/weatherPolling';
import {weatherCurrent,type WeatherLayer} from '../data/weather';
export function useWeatherLayer(layer:WeatherLayer,enabled:boolean){
 const [state,setState]=useState<WeatherLoad>({phase:'off',message:''});
 const lastGood=useRef<WeatherLoad|null>(null);
 const gate=useRef({notBefore:0});
 useEffect(()=>{
  if(!enabled)return;
  return startWeatherPolling(weatherUrl,layer,gate.current,next=>{
   if(next.phase==='ready')lastGood.current=next;
   const cached=lastGood.current;
   setState(next.phase==='loading'&&cached?.phase==='ready'&&weatherCurrent(cached.data,Date.now()/1000)?cached:next);
  });
 },[layer,enabled]);
 return enabled?state:{phase:'off' as const,message:''};
}
export function useWeatherPreferences(){
 const [preferences,setPreferences]=useState(()=>{
  try{const v=JSON.parse(sessionStorage.getItem('changi-weather')??'{}');return {wind:v?.wind===true,radar:v?.radar===true,opacity:typeof v?.opacity==='number'?Math.max(.1,Math.min(.85,v.opacity)):.6}}catch{return {wind:false,radar:false,opacity:.6}}
 });
 useEffect(()=>{try{sessionStorage.setItem('changi-weather',JSON.stringify(preferences))}catch{/* Storage is optional. */}},[preferences]);
 return [preferences,setPreferences] as const;
}

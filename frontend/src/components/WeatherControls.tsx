import type {RadarPlayback} from '../hooks/useRadarPlayback';
import {replayStatus} from './RadarReplayControls';
import {useEffect,useRef,useState} from 'react';
import {Wind,CloudRain,CloudSun} from 'lucide-react';
import {weatherCurrent} from '../data/weather';
import {WIND_SPEED_STOPS} from '../data/windScale';
import type {WeatherLoad} from '../data/weatherPolling';
import {useWeatherLayer} from '../hooks/useWeather';
import ChangiOutlook,{changiOutlookId} from './ChangiOutlook';
interface Preferences {wind:boolean;radar:boolean;opacity:number}
interface Props {playback?:RadarPlayback;preferences:Preferences;onChange:(p:Preferences)=>void;wind:WeatherLoad;radar:WeatherLoad;unavailable:string|null;now:number;radarError:boolean}
const timeFormat=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const time=(at:number)=>timeFormat.format(new Date(at*1000));
function status(load:WeatherLoad,now:number,imageError=false){
 if(imageError)return 'Radar image unavailable. Waiting for the next frame.';
 if(load.phase!=='ready')return load.message;
 const data=load.data;
 if(!weatherCurrent(data,now))return data.message??(data.state==='unavailable'?'Weather unavailable.':data.layer==='wind_regional'&&!data.points.length?'No regional wind estimates.':data.layer==='wind'&&!data.stations.length?'No reporting stations.':'Out of date. Overlay hidden.');
 if(data.layer==='wind_regional')return `Model valid ${time(data.observed_at!)} SGT · ${data.points.length} model ${data.points.length===1?'point':'points'}`;
 return `${data.layer==='wind'?`${data.stations.length} stations · `:''}${time(data.observed_at!)} SGT`;
}
export default function WeatherControls({preferences,onChange,wind,radar,unavailable,now,radarError,playback}:Props){
 const [opacity,setOpacity]=useState(preferences.opacity);
 const [outlookOpen,setOutlookOpen]=useState(false);
 const outlookButton=useRef<HTMLButtonElement>(null);
 const showOutlook=outlookOpen&&!unavailable;
 const outlook=useWeatherLayer('changi_outlook',showOutlook);
 useEffect(()=>{if(unavailable)setOutlookOpen(false)},[unavailable]);
 const dismissOutlook=()=>{
  setOutlookOpen(false);
  requestAnimationFrame(()=>outlookButton.current?.focus());
 };
 const enabled=preferences.wind||preferences.radar;
 const toggle=(layer:'wind'|'radar')=>onChange({...preferences,[layer]:!preferences[layer]});
 const commit=()=>onChange({...preferences,opacity});
 return <section className="weather-controls panel" aria-label="Weather layers">
  <div className="weather-buttons">
   <button aria-pressed={preferences.wind} disabled={!!unavailable} onClick={()=>toggle('wind')}><Wind size={15}/><span>Wind</span></button>
   <button aria-pressed={preferences.radar} disabled={!!unavailable} onClick={()=>toggle('radar')}><CloudRain size={15}/><span>Rain radar</span></button>
   <button ref={outlookButton} aria-haspopup="dialog" aria-expanded={showOutlook} aria-controls={showOutlook?changiOutlookId:undefined} disabled={!!unavailable} onClick={()=>showOutlook?dismissOutlook():setOutlookOpen(true)}><CloudSun size={15}/><span>Changi outlook</span></button>
  </div>
  {unavailable?<p className="weather-note">{unavailable}</p>:enabled&&<details className="weather-details" open>
   <summary>Weather details</summary>
   {preferences.wind&&<div className="weather-legend">
    <strong>Regional surface wind · 10 m</strong>
    <p role="status">{status(wind,now)}</p>
    <div className="wind-scale" style={{background:`linear-gradient(90deg, ${WIND_SPEED_STOPS.map(({speed,color})=>`${color} ${speed*10}%`).join(', ')})`}}/>
    <div className="wind-scale-key">
     <ol className="wind-scale-labels" role="list" aria-label="Wind speed in metres per second">
      {WIND_SPEED_STOPS.map(({speed},index)=><li key={speed} style={{left:`${speed*10}%`}}>{speed}{index===WIND_SPEED_STOPS.length-1?'+':''}</li>)}
     </ol>
     <span aria-hidden="true">m/s</span>
    </div>
    <small>Model grid · 500 km region. Trails and arrowheads point downwind.</small>
    {playback?.showHistoryBanner&&<p>Wind uses the latest model time during radar playback.</p>}
    <a className="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo · CC BY 4.0</a>
   </div>}
   {preferences.radar&&<div className="weather-legend"><strong>Rain radar · 480 km</strong><p role="status">{playback?.showHistoryBanner?replayStatus(playback):status(radar,now,radarError)}</p>{playback&&!playback.showHistoryBanner&&<button className="radar-history-open" onClick={playback.enter}>Past hour</button>}<div className="rain-scale"/><div className="rain-labels"><span>Light</span><span>Heavy</span></div><label className="weather-opacity">Opacity <output>{Math.round(opacity*100)}%</output><input aria-label="Radar opacity" type="range" min="10" max="85" step="5" value={opacity*100} onChange={e=>setOpacity(Number(e.target.value)/100)} onPointerUp={commit} onKeyUp={commit} onBlur={commit}/></label></div>}
   {preferences.radar&&<a className="weather-credit" href="https://data.gov.sg/datasets/d_418e9ac3414fd927b7405631e0a7bc82/view" target="_blank" rel="noreferrer">MSS / NEA via data.gov.sg</a>}
  </details>}
  {showOutlook&&<ChangiOutlook load={outlook} now={now} onDismiss={dismissOutlook}/>}
 </section>;
}

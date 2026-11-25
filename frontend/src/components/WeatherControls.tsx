import type {RadarPlayback} from '../hooks/useRadarPlayback';
import {replayStatus} from './RadarReplayControls';
import {useState} from 'react';
import {Wind,CloudRain} from 'lucide-react';
import {weatherCurrent} from '../data/weather';
import type {WeatherLoad} from '../data/weatherPolling';
interface Preferences {wind:boolean;radar:boolean;opacity:number}
interface Props {playback?:RadarPlayback;preferences:Preferences;onChange:(p:Preferences)=>void;wind:WeatherLoad;radar:WeatherLoad;unavailable:string|null;now:number;radarError:boolean}
const time=(at:number)=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at*1000));
function status(load:WeatherLoad,now:number,imageError=false){
 if(imageError)return 'Radar image unavailable. Waiting for the next frame.';
 if(load.phase!=='ready')return load.message;
 const data=load.data;
 if(!weatherCurrent(data,now))return data.message??(data.state==='unavailable'?'Weather unavailable.':data.layer==='wind_regional'&&!data.points.length?'No regional wind estimates.':data.layer==='wind'&&!data.stations.length?'No reporting stations.':'Out of date. Overlay hidden.');
 if(data.layer==='wind_regional')return `Valid ${time(data.observed_at!)} SGT · ${data.points.length} model points`;
 return `${data.layer==='wind'?`${data.stations.length} stations · `:''}${time(data.observed_at!)} SGT`;
}
export default function WeatherControls({preferences,onChange,wind,radar,unavailable,now,radarError,playback}:Props){
 const [opacity,setOpacity]=useState(preferences.opacity);
 const enabled=preferences.wind||preferences.radar;
 const toggle=(layer:'wind'|'radar')=>onChange({...preferences,[layer]:!preferences[layer]});
 const commit=()=>onChange({...preferences,opacity});
 return <section className="weather-controls panel" aria-label="Weather layers">
  <div className="weather-buttons">
   <button aria-pressed={preferences.wind} disabled={!!unavailable} onClick={()=>toggle('wind')}><Wind size={15}/>Wind</button>
   <button aria-pressed={preferences.radar} disabled={!!unavailable} onClick={()=>toggle('radar')}><CloudRain size={15}/>Rain radar</button>
  </div>
  {unavailable?<p className="weather-note">{unavailable}</p>:enabled&&<details className="weather-details" open>
   <summary>Weather details</summary>
   {preferences.wind&&<div className="weather-legend"><strong>Regional wind · 500 km</strong><p role="status">{status(wind,now)}</p><div className="wind-scale"><span>● &lt;2</span><span>● 2–&lt;5</span><span>● ≥5 m/s</span></div><small>Modelled surface wind · 10 m height.<br/>Arrows point downwind at model samples.</small><a className="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo · CC BY 4.0</a></div>}
   {preferences.radar&&<div className="weather-legend"><strong>Rain radar · 480 km</strong><p role="status">{playback?.showHistoryBanner?replayStatus(playback):status(radar,now,radarError)}</p>{playback&&!playback.showHistoryBanner&&<button className="radar-history-open" onClick={playback.enter}>Past hour</button>}<div className="rain-scale"/><div className="rain-labels"><span>Light</span><span>Heavy</span></div><label className="weather-opacity">Opacity <output>{Math.round(opacity*100)}%</output><input aria-label="Radar opacity" type="range" min="10" max="85" step="5" value={opacity*100} onChange={e=>setOpacity(Number(e.target.value)/100)} onPointerUp={commit} onKeyUp={commit} onBlur={commit}/></label></div>}
   {preferences.radar&&<a className="weather-credit" href="https://data.gov.sg/datasets/d_418e9ac3414fd927b7405631e0a7bc82/view" target="_blank" rel="noreferrer">MSS / NEA via data.gov.sg</a>}
  </details>}
 </section>;
}

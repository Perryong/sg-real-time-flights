import {useEffect,useRef} from 'react';
import {X,RotateCcw,Plane,ArrowRight} from 'lucide-react';
import {followSample,defaultFollowCamera,type FollowCamera,type FollowSample} from '../data/follow';
import {aircraftModel} from '../data/aircraftModels';
import {routeFor} from '../data/routes';
import type {Track,Mode} from '../data/types';
export type FollowStyle='satellite'|'day'|'night';
interface Props {track:Track;tracks:Track[];now:number;mode:Mode;camera:FollowCamera;style:FollowStyle;trails:boolean;onCamera:(c:FollowCamera)=>void;onStyle:(s:FollowStyle)=>void;onTrails:()=>void;onSelect:(id:string)=>void;onExit:()=>void}
const measure=(value:number|null|undefined,factor=1)=>value==null||!Number.isFinite(value)?'—':Math.round(value*factor).toLocaleString();
export default function FollowPanel(p:Props){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  const box=panel.current,container=box?.parentElement;if(!box||!container)return;
  const resize=()=>container.style.setProperty('--follow-panel-height',`${box.getBoundingClientRect().height+24}px`);
  const observer=new ResizeObserver(resize);observer.observe(box);resize();
  return ()=>{observer.disconnect();container.style.removeProperty('--follow-panel-height')};
 },[]);
 const current=followSample(p.track,p.now),held=useRef<{id:string;sample:FollowSample}|null>(null);
 if(current)held.current={id:p.track.id,sample:current};
 const frame=held.current?.id===p.track.id?held.current.sample:null;
 const o=p.track.latest,route=routeFor(o,p.now),age=o.position_time===null?null:Math.max(0,Math.floor(p.now-o.position_time));
 const model=aircraftModel(o.aircraft_type);
 return <section ref={panel} className="follow-panel" aria-label="3D aircraft follow">
  <div className="follow-card-heading"><div className="follow-plane-badge"><Plane size={26}/></div><div className="follow-identity"><span>{p.mode==='live'?'3D FLIGHT VIEW':'SIMULATED / RECORDED · NOT LIVE'}</span><h2>{o.callsign||o.provider_id}</h2><p>{o.registration||'Registration unknown'} · {model.name}</p></div><button className="icon-button" aria-label="Exit aircraft follow" onClick={p.onExit}><X size={20}/></button></div>
  <div className={`follow-route ${route?'':'route-unknown'}`}><strong>{route?.origin_iata||route?.origin||'Unknown'}</strong><span><ArrowRight size={17}/>{route?'Previously observed route · not a confirmed itinerary':'Route unavailable'}</span><strong>{route?.destination_iata||route?.destination||'Unknown'}</strong></div>
  <div className="follow-measures"><div><span>{frame?.altitudeLabel||'Altitude'}</span><strong>{measure(frame?.altitude,1/0.3048)} <small>ft</small></strong></div><div><span>Ground speed</span><strong>{measure(frame?.speed,3600/1852)} <small>kt</small></strong></div><div><span>{frame?.headingLabel||'Direction unknown'}</span><strong>{measure(frame?.heading)}<small>{frame?.heading!=null?'°':''}</small></strong></div></div>
  <p className={`follow-status ${current?'':'paused'}`} role="status">{current?`Observed ${age??'—'}s ago · display ${frame?.renderTime!=null?new Date(frame.renderTime*1000).toISOString().slice(11,19)+' UTC':'—'}`:'View paused · fresh airborne position and altitude required'} · {o.provider}{frame?.heading===null?' · camera uses north as reference':''}</p>
  <details className="follow-options"><summary>View controls</summary><div className="follow-controls">
   <label>Distance · {p.camera.distance} m<input aria-label="Follow distance" type="range" min="80" max="1500" step="10" value={p.camera.distance} onChange={e=>p.onCamera({...p.camera,distance:+e.target.value})}/></label>
   <label>Orbit · {p.camera.orbit}°<input aria-label="Follow orbit" type="range" min="-180" max="180" value={p.camera.orbit} onChange={e=>p.onCamera({...p.camera,orbit:+e.target.value})}/></label>
   <label>Elevation · {p.camera.elevation}°<input aria-label="Follow elevation" type="range" min="5" max="60" value={p.camera.elevation} onChange={e=>p.onCamera({...p.camera,elevation:+e.target.value})}/></label>
   <button onClick={()=>p.onCamera({...defaultFollowCamera})}><RotateCcw size={14}/> Reset behind aircraft</button>
   <label>Map style<select aria-label="Follow map style" value={p.style} onChange={e=>p.onStyle(e.target.value as FollowStyle)}><option value="satellite">Satellite · 2024 imagery</option><option value="day">Day map</option><option value="night">Night map</option></select></label>
   <button aria-pressed={p.trails} onClick={p.onTrails}>{p.trails?'Hide':'Show'} observed trail</button>
   <label className="follow-switch">Aircraft<select aria-label="Follow another aircraft" value={p.track.id} onChange={e=>p.onSelect(e.target.value)}>{p.tracks.filter(t=>t.id===p.track.id||followSample(t,p.now)!==null).map(t=><option key={t.id} value={t.id}>{t.latest.callsign||t.latest.provider_id}</option>)}</select></label>
   <small>Approximate altitude · {model.credit} · flat terrain · artistic sky, not live weather.</small>
  </div></details>
 </section>
}

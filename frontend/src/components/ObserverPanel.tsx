import {useEffect,useRef,useState} from 'react';
import type {Mode,Track} from '../data/types';
import {isSingaporePin,nearbyAircraft,type ObserverPin} from '../data/observer';
import {postalSearchUrl} from '../data/hosting';
export interface SkyAim {heading:number;pitch:number}
interface Props {pin:ObserverPin|null;placing:boolean;sky:boolean;aim:SkyAim;tracks:Track[];now:number;mode:Mode;mapReady:boolean;
 onPin:(pin:ObserverPin)=>void;onPlace:()=>void;onCancel:()=>void;onRemove:()=>void;onCenter:()=>void;onSky:()=>void;onLook:(track:Track)=>void;onAim:(aim:SkyAim)=>void}
interface PostalResult {lat:number;lon:number;label:string;postal?:string}
export default function ObserverPanel(p:Props){
 const [postal,setPostal]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[results,setResults]=useState<PostalResult[]>([]);
 const request=useRef<AbortController|null>(null);
 const cancel=()=>{request.current?.abort();request.current=null;setBusy(false);setResults([])};
 useEffect(()=>{cancel();return ()=>{request.current?.abort();request.current=null}},[p.pin,p.placing]);
 const choose=(r:PostalResult)=>{cancel();setError('');p.onPin({lat:r.lat,lon:r.lon,height:2,label:r.label})};
 const search=async(e:React.FormEvent)=>{
  e.preventDefault();cancel();setError('');
  if(!/^\d{6}$/.test(postal)){setError('Enter a six-digit Singapore postal code.');return}
  const controller=new AbortController();request.current=controller;setBusy(true);
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(postalSearchUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postal}),signal:controller.signal,credentials:'omit'});
   if(!response.ok)throw Error(response.status===429?'Too many searches. Wait a minute or use Drop pin.':'Postal search is unavailable. Use Drop pin for now.');
   const body=await response.json();
   if(controller!==request.current||controller.signal.aborted)return;
   const found:PostalResult[]=Array.isArray(body.results)?body.results.filter((r:PostalResult)=>typeof r.label==='string'&&isSingaporePin({...r,height:2})):[];
   if(!found.length){setError('No matching Singapore address found. Try another code or drop a pin.');return}
   if(found.length===1)choose(found[0]);else setResults(found);
  }catch(e){if(controller===request.current)setError(e instanceof Error&&!controller.signal.aborted?e.message:'Search timed out. Try again or drop a pin.')}
  finally{clearTimeout(timeout);if(controller===request.current){request.current=null;setBusy(false)}}
 };
 const nearby=p.pin?nearbyAircraft(p.pin,p.tracks,p.now):[];
 return <section className="observer-panel panel traffic-panel" aria-label="My location and nearby aircraft">
  <div className="observer-heading"><span className="eyebrow">YOUR OBSERVATION POINT</span><h2>My location</h2><p>Pin a spot in Singapore to find aircraft around you.</p></div>
  <form aria-label="Find postal code" onSubmit={search}>
   <label htmlFor="observer-postal">Singapore postal code</label>
   <div className="observer-search"><input id="observer-postal" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="e.g. 018956" value={postal} onChange={e=>{cancel();setPostal(e.target.value);setError('')}}/><button type="submit" disabled={busy}>{busy?'Finding…':'Find'}</button></div>
   <small>Search sends this postal code to OneMap via our server.</small>
  </form>
  {error&&<p role="alert" className="observer-error">{error}</p>}
  {results.map((r,i)=><button key={i} onClick={()=>choose(r)}>{r.label}</button>)}
  <div className="observer-actions"><button disabled={!p.mapReady} onClick={()=>{cancel();setError('');p.placing?p.onCancel():p.onPlace()}}>{p.placing?'Cancel pin placement':'Drop pin'}</button>{p.pin&&<button onClick={()=>{cancel();p.onRemove()}}>Remove pin</button>}</div>
  {p.placing&&<p role="status">Tap or click the map to place your pin. Press Escape to cancel.</p>}
  {!p.mapReady&&<p>Map unavailable. Postal lookup and nearby distances still work.</p>}
  {p.pin&&<>
   <div className="observer-position"><strong>{p.pin.label||'Dropped pin'}</strong><span>{p.pin.lat.toFixed(5)}° N, {p.pin.lon.toFixed(5)}° E</span><small>Pin stays in this tab only.</small></div>
   <div className="observer-actions"><button disabled={!p.mapReady} onClick={p.onCenter}>Center on pin</button><button disabled={!p.mapReady} onClick={p.onSky}>{p.sky?'Return to map':'Sky view from pin'}</button></div>
   {p.sky&&<fieldset className="observer-sky"><legend>Look around</legend>
    <label>View height above map (m)<input aria-label="View height above map" type="number" min={2} max={500} value={p.pin.height} onChange={e=>{const height=Number(e.target.value);if(height>=2&&height<=500)p.onPin({...p.pin!,height})}}/></label>
    <label>Direction {Math.round(p.aim.heading)}°<input aria-label="Sky direction" type="range" min={0} max={359} value={p.aim.heading} onChange={e=>p.onAim({...p.aim,heading:Number(e.target.value)})}/></label>
    <label>Look up {Math.round(p.aim.pitch)}°<input aria-label="Sky elevation" type="range" min={-5} max={90} value={p.aim.pitch} onChange={e=>p.onAim({...p.aim,pitch:Number(e.target.value)})}/></label>
    <p>Approximate view. Terrain and buildings do not block aircraft here. Heights and aircraft sizes are estimated.</p>
   </fieldset>}
   <h3>Nearby aircraft · 25 km</h3><p className="observer-caption">{p.mode==='live'?'Fresh airborne positions':'SIMULATED / RECORDED · NOT LIVE'} · horizontal distance from your pin</p>
   {!nearby.length&&<p>No fresh airborne aircraft within 25 km. Missing coverage does not mean the sky is empty.</p>}
   <ul className="observer-aircraft">{nearby.map(a=><li key={a.track.id}><strong>{a.track.latest.callsign||a.track.latest.provider_id}</strong><span>{a.distanceKm.toFixed(1)} km · {a.direction} {Math.round(a.bearing)}°</span><small>{a.elevation===null?'Elevation unknown':`${Math.round(a.elevation)}° elevation · ${Math.round(a.altitude!)} m altitude · ${a.altitudeApproximate?'barometric estimate':'approximate'}`}</small><button disabled={!p.mapReady||a.elevation===null||a.elevation<0} onClick={()=>p.onLook(a.track)} aria-label={`Look at ${a.track.latest.callsign||a.track.latest.provider_id}`}>{a.elevation!==null&&a.elevation<0?'Below estimated horizon':'Look at aircraft'}</button></li>)}</ul>
  </>}
 </section>
}

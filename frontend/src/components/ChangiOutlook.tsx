import {useLayoutEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {changiForecastDates,outlookFreshness,weatherCodeLabel} from '../data/weather';
import type {WeatherLoad} from '../data/weatherPolling';

export const changiOutlookId='changi-outlook';
const dateTime=new Intl.DateTimeFormat('en-SG',{
 timeZone:'Asia/Singapore',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});
const weekday=new Intl.DateTimeFormat('en-SG',{timeZone:'UTC',weekday:'long'});
const calendarDate=new Intl.DateTimeFormat('en-SG',{timeZone:'UTC',day:'numeric',month:'short'});
const unavailable='Unavailable';

function OutlookTime({at}:{at:number|null|undefined}){
 if(at==null)return <>{unavailable}</>;
 const date=new Date(at*1000);
 return <time dateTime={date.toISOString()}>{dateTime.format(date)} SGT</time>;
}

export default function ChangiOutlook({load,now,modal,onDismiss}:{load:WeatherLoad;now:number;modal:boolean;onDismiss:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const close=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  const element=dialog.current!;
  if(modal)element.showModal();
  else element.show();
  close.current?.focus();
  return ()=>{if(element.open)element.close()};
 },[modal]);
 const dismiss=()=>{
  dialog.current?.close();
  onDismiss();
 };

 const data=load.phase==='ready'&&load.data.layer==='changi_outlook'?load.data:load.phase==='error'?load.cached:undefined;
 const freshness=outlookFreshness(data,now);
 const current=freshness.current==='unavailable'?undefined:data?.current;
 const forecast=freshness.forecast==='unavailable'?[]:data?.daily;
 const daily=changiForecastDates(now).map(date=>[date,forecast?.find(day=>day.date===date)] as const);
 const message=load.phase==='ready'?data?.message:load.message;
 const hasValues=current?.humidity_pct!=null||current?.pressure_msl_hpa!=null||daily.some(([,day])=>
  day!=null&&(day.weather_code!=null||day.low_c!=null||day.high_c!=null));
 const loading=load.phase==='loading'||load.phase==='off';
 const failed=load.phase==='error'||Boolean(data?.message);
 const status=loading?'Loading Changi outlook…':failed&&hasValues?'Refresh failed. Showing the last available values.':message;
 const metric=(value:number|null|undefined,unit:string)=>value==null?unavailable:`${Math.round(value)}${unit}`;
 const temperature=(value:number|null|undefined)=>value==null?unavailable:`${value} °C`;

 return <dialog className="changi-outlook panel" id={changiOutlookId} ref={dialog} aria-labelledby="changi-outlook-title"
  onCancel={event=>{event.preventDefault();dismiss()}}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss()}}}>
  <header className="outlook-heading">
   <h2 id="changi-outlook-title">Changi Airport, Singapore</h2>
   <button className="outlook-close" type="button" ref={close} aria-label="Close Changi outlook" onClick={dismiss}><X size={19}/></button>
   <p>Modelled weather · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></p>
  </header>
  {status&&<p className="outlook-status" role="status">{status}</p>}
  <section className="outlook-section" aria-labelledby="outlook-current-heading">
   <h3 id="outlook-current-heading">Current conditions</h3>
   <p className="outlook-timestamp">Model valid <OutlookTime at={data?.observed_at}/>{freshness.current==='stale'&&<strong>Stale</strong>}</p>
   <dl className="outlook-current">
    <div><dt>Relative humidity at 2 m</dt><dd>{metric(current?.humidity_pct,'%')}</dd></div>
    <div><dt>Mean sea-level pressure</dt><dd>{metric(current?.pressure_msl_hpa,' hPa')}</dd></div>
   </dl>
  </section>
  <section className="outlook-section" aria-labelledby="outlook-forecast-heading">
   <h3 id="outlook-forecast-heading">Next five days</h3>
   <p className="outlook-timestamp">Last successful forecast retrieval <OutlookTime at={data?.fetched_at}/>{freshness.forecast==='stale'&&<strong>Stale</strong>}</p>
   <ol className="outlook-days" role="list" aria-labelledby="outlook-forecast-heading">
    {daily.map(([date,day])=>{
     const parsedDate=new Date(`${date}T00:00:00Z`);
     return <li key={date}>
      <time dateTime={date}><strong>{weekday.format(parsedDate)}</strong><span>{calendarDate.format(parsedDate)}</span></time>
      <span>{weatherCodeLabel(day?.weather_code??null)??unavailable}</span>
      <dl className="outlook-temperatures">
       <div><dt>Low</dt><dd>{temperature(day?.low_c)}</dd></div>
       <div><dt>High</dt><dd>{temperature(day?.high_c)}</dd></div>
      </dl>
     </li>;
    })}
   </ol>
  </section>
 </dialog>;
}

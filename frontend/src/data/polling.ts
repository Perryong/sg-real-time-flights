import {isSnapshot} from './stream';
import type {Snapshot} from './types';

/** Short requests keep the free cloud backend idle when nobody is viewing. */
export function startPolling(url:string,onSnapshot:(snapshot:Snapshot,responseNow?:number)=>void,onState:(state:string)=>void) {
  let stopped=false, pending=false, notBefore=0, timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  const hidden=()=>document.visibilityState==='hidden';
  const poll=async()=>{
    if(stopped || pending || hidden()) return;
    if(Date.now()<notBefore) {timer=setTimeout(poll,notBefore-Date.now());return;}
    pending=true; controller=new AbortController();
    const request=controller;
    const started=Date.now();
    const deadline=setTimeout(()=>request.abort('timeout'),20000);
    let delay=15000;
    try {
      const response=await fetch(url,{signal:request.signal,cache:'no-store',credentials:'omit'});
      if(!response.ok) {
        const retry=Number(response.headers.get('Retry-After'));
        delay=Number.isFinite(retry)&&retry>0 ? Math.min(300000,Math.max(15000,retry*1000)) : 60000;
        throw Error('Feed unavailable');
      }
      const data=await response.json();
      if(!isSnapshot(data)||data.mode!=='live') throw Error('Invalid feed');
      const header=response.headers.get('X-Response-Time');
      const server=Number(header),age=Number(response.headers.get('Age')||0);
      const responseNow=header!==null&&Number.isFinite(server)&&server>0&&Number.isFinite(age)&&age>=0&&age<=300
        ? server+age+Math.max(0,Date.now()-started)/2000 : undefined;
      if(!stopped&&!request.signal.aborted) {onSnapshot(data,responseNow);onState('connected');}
    } catch {
      if(request.signal.reason==='hidden') delay=0;
      else {
        if(!stopped&&!hidden()) onState('unavailable');
        delay=Math.max(delay,60000);notBefore=Date.now()+delay;
      }
    } finally {
      clearTimeout(deadline);pending=false;
      if(!stopped&&!hidden()) timer=setTimeout(poll,Math.max(delay,notBefore-Date.now()));
    }
  };
  const visibility=()=>{
    clearTimeout(timer);
    if(hidden()) {controller?.abort('hidden');onState('paused');}
    else if(!pending) void poll();
  };
  document.addEventListener('visibilitychange',visibility);
  void poll();
  return ()=>{stopped=true;clearTimeout(timer);controller?.abort('disposed');document.removeEventListener('visibilitychange',visibility);};
}

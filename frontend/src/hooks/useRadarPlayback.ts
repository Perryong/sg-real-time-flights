import {useCallback,useEffect,useMemo,useState} from 'react';
import {historyFrames,type RadarFrame} from '../data/weather';
import {useWeatherLayer} from './useWeather';

export function useRadarPlayback(enabled:boolean,liveFrame:RadarFrame|null,now:number){
 const [mode,setMode]=useState<'live'|'history'>('live');
 const [playing,setPlaying]=useState(false),[selectedAt,setSelectedAt]=useState<number|null>(null);
 const [displayedAt,setDisplayedAt]=useState<number|null>(null),[displayedHistorical,setDisplayedHistorical]=useState(false);
 const [failedUrl,setFailedUrl]=useState<string|null>(null);
 const [visible,setVisible]=useState(()=>document.visibilityState!=='hidden');
 const history=useWeatherLayer('radar_history',enabled&&mode==='history');
 const data=history.phase==='ready'&&history.data.layer==='radar_history'?history.data:null;
 const second=Math.floor(now);
 const frames=useMemo(()=>data?historyFrames(data,second):[],[data,second]);
 const index=selectedAt===null?0:Math.max(0,frames.findIndex(f=>f.observed_at===selectedAt));
 const desired=enabled?(mode==='history'?frames[index]??null:liveFrame):null;
 const imageError=!!desired&&desired.url===failedUrl;
 const frame=imageError?null:desired;
 const onReady=useCallback((at:number|null)=>{setDisplayedAt(at);setDisplayedHistorical(at!==null&&mode==='history')},[mode]);
 const onError=useCallback(()=>{setFailedUrl(desired?.url??null);setPlaying(false)},[desired?.url]);
 useEffect(()=>{
  if(!enabled){setMode('live');setPlaying(false);setSelectedAt(null);setFailedUrl(null)}
 },[enabled]);
 useEffect(()=>{
  if(mode!=='history')return;
  if(!frames.length){setPlaying(false);return;}
  if(selectedAt!==null&&frames.some(f=>f.observed_at===selectedAt))return;
  const nearest=selectedAt===null?frames[0]:frames.reduce((a,b)=>Math.abs(a.observed_at-selectedAt)<=Math.abs(b.observed_at-selectedAt)?a:b);
  setSelectedAt(nearest.observed_at);setPlaying(false);
 },[frames,selectedAt,mode]);
 useEffect(()=>{
  const change=()=>{const shown=document.visibilityState!=='hidden';setVisible(shown);if(!shown)setPlaying(false)};
  document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);
 },[]);
 const nextAt=frames.length>1?frames[(index+1)%frames.length]?.observed_at:null;
 const loaded=frame!==null&&displayedAt===frame.observed_at;
 useEffect(()=>{
  if(!enabled||mode!=='history'||!playing||!visible||!loaded||imageError||nextAt==null)return;
  const timer=setTimeout(()=>setSelectedAt(nextAt),2000);return()=>clearTimeout(timer);
 },[enabled,mode,playing,visible,loaded,imageError,nextAt,displayedAt]);
 const enter=()=>{if(enabled){setSelectedAt(null);setPlaying(false);setFailedUrl(null);setMode('history')}};
 const returnLive=()=>{setMode('live');setPlaying(false);setSelectedAt(null);setFailedUrl(null)};
 const seek=(i:number)=>{if(Number.isInteger(i)&&frames[i]){setSelectedAt(frames[i].observed_at);setPlaying(false)}};
 const togglePlay=()=>{if(playing){setPlaying(false);return}if(enabled&&visible&&mode==='history'&&frames.length>1&&loaded&&!imageError)setPlaying(p=>!p)};
 return {mode,playing,frames,index,frame,displayedAt,loaded,imageError,history,enter,returnLive,seek,togglePlay,onReady,onError,
  showHistoryBanner:enabled&&(mode==='history'||displayedHistorical)};
}
export type RadarPlayback=ReturnType<typeof useRadarPlayback>;

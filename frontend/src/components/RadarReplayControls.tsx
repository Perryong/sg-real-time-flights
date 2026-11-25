import type {RadarPlayback} from '../hooks/useRadarPlayback';
export const radarTime=(at:number)=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at*1000))+' SGT';
export function replayStatus(p:RadarPlayback){
 if(p.mode==='live')return 'Returning to live radar…';
 if(p.imageError)return 'Selected image unavailable. Choose another frame or return to live.';
 if(p.history.phase!=='ready')return p.history.message;
 if(!p.frames.length)return 'No usable images in this hour. Waiting for an update.';
 if(!p.loaded)return 'Loading selected frame…';
 return p.history.data.message??(p.history.data.state==='stale'?'Cached history · updates delayed':`${p.frames.length}/13 frames available${p.frames.length<13?' · missing frames omitted':''}`);
}
export default function RadarReplayControls({playback:p}:{playback:RadarPlayback}){
 if(!p.showHistoryBanner)return null;
 const first=p.frames[0],last=p.frames.at(-1),selected=p.frames[p.index];
 return <section className="radar-history-banner panel" aria-label="Rain radar playback">
  <div className="radar-replay-heading"><strong>HISTORICAL RAIN</strong><span>Aircraft remain live</span></div>
  <div className="radar-replay-time" role="status">{p.displayedAt===null?'No radar image displayed':`Shown ${radarTime(p.displayedAt)}`}</div>
  <div className="radar-replay-actions">
   <button disabled={!p.playing&&(p.mode!=='history'||p.frames.length<2||!p.loaded||p.imageError)} onClick={p.togglePlay}>{p.playing?'Pause radar':'Play radar'}</button>
   <button onClick={p.returnLive}>Return to Live</button>
  </div>
  <input aria-label="Rain radar time" aria-valuetext={selected?radarTime(selected.observed_at):'No frames available'} type="range" min="0" max={Math.max(0,p.frames.length-1)} step="1" value={p.index} disabled={p.mode!=='history'||p.frames.length<2} onChange={e=>p.seek(Number(e.target.value))}/>
  {first&&last&&<div className="radar-replay-range"><span>{radarTime(first.observed_at)}</span><span>{radarTime(last.observed_at)}</span></div>}
  <p className="radar-replay-status">{replayStatus(p)}</p>
 </section>;
}

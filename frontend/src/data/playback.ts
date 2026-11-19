import type { Snapshot } from './types';
import {isSnapshot} from './stream';
export class PlaybackController {
 playing=false;
 private anchorWall=0;
 private anchorTime:number;
 readonly start:number;
 readonly end:number;
 constructor(public frames:Snapshot[],private clock:()=>number){
  if(!frames.length||!frames.every(isSnapshot)||frames.some(f=>f.mode==='live'||f.scenario_time===null))throw Error('Invalid non-live fixture');
  if(frames.some((f,i)=>i>0&&f.scenario_time!<=frames[i-1].scenario_time!))throw Error('Unordered fixture');
  this.start=frames[0].scenario_time!;this.end=frames.at(-1)!.scenario_time!;this.anchorTime=this.start;
 }
 get time(){return Math.min(this.end,this.anchorTime+(this.playing?Math.max(0,this.clock()-this.anchorWall):0));}
 play(){if(!this.playing){this.anchorWall=this.clock();this.playing=true;}}
 pause(){this.anchorTime=this.time;this.playing=false;}
 seek(time:number){this.anchorTime=Math.max(this.start,Math.min(this.end,time));this.anchorWall=this.clock();}
 tick(){const now=this.time;if(now>=this.end)this.pause();let frame=this.frames[0];for(const f of this.frames){if(f.scenario_time!>now)break;frame=f;}return frame;}
 dispose(){this.pause();}
}

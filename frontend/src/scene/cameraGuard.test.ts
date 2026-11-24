import {it,expect,vi} from 'vitest';
import {ScreenSpaceEventType,type ScreenSpaceEventHandler} from 'cesium';
import {guardCameraDoubleClick} from './cameraGuard';
it('blocks the Viewer double-click action while pinned or placing and restores it afterwards',()=>{
 const original=vi.fn();let locked=false;let action:(event:unknown)=>void=original;
 const handler={getInputAction:()=>original,setInputAction:vi.fn(fn=>{action=fn})} as unknown as ScreenSpaceEventHandler;
 guardCameraDoubleClick(handler,()=>locked);
 expect(handler.setInputAction).toHaveBeenCalledWith(expect.any(Function),ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
 action({});expect(original).toHaveBeenCalledTimes(1);
 locked=true;action({});expect(original).toHaveBeenCalledTimes(1);
 locked=false;action({});expect(original).toHaveBeenCalledTimes(2);
});

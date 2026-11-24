import {ScreenSpaceEventType,type ScreenSpaceEventHandler} from 'cesium';
// Viewer entity tracking bypasses screenSpaceCameraController.enableInputs.
export function guardCameraDoubleClick(handler:ScreenSpaceEventHandler,isLocked:()=>boolean){
 const original=handler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK) as ScreenSpaceEventHandler.PositionedEventCallback | undefined;
 handler.setInputAction((event:ScreenSpaceEventHandler.PositionedEvent)=>{if(!isLocked())original?.(event)},ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {SunLight,Cartesian3,Event as CesiumEvent} from 'cesium';
import {addFollowEnvironment} from './environment';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 let image:HTMLImageElement;
 vi.stubGlobal("ImageBitmap",class ImageBitmap {});
 vi.stubGlobal("OffscreenCanvas",class OffscreenCanvas {});
 vi.stubGlobal('Image',function(){image=document.createElement('img');return image});
 const light=new SunLight();
 const viewer={camera:{directionWC:new Cartesian3(0,0,-1)},scene:{preRender:new CesiumEvent(),light,skyAtmosphere:{show:true},primitives:{add:vi.fn(x=>x),remove:vi.fn()}},shadows:false,shadowMap:{softShadows:false,maximumDistance:5000,darkness:.8},isDestroyed:()=>false};
 const unavailable=vi.fn();
 const cleanup=addFollowEnvironment(viewer as never,1.35,104,unavailable);
 return {viewer,light,unavailable,cleanup,image:image!};
}
it('restores lighting, shadow settings and atmosphere when leaving follow',()=>{
 const {viewer,light,cleanup,image}=setup();
 image.dispatchEvent(new Event('load'));
 expect(viewer.scene.primitives.add).toHaveBeenCalledOnce();
 expect(viewer.scene.skyAtmosphere.show).toBe(false);
 cleanup();
 expect(viewer.scene.primitives.remove).toHaveBeenCalledOnce();
 expect(viewer.scene.light).toBe(light);
 expect(viewer.scene.preRender.numberOfListeners).toBe(0);
 expect(viewer.shadows).toBe(false);
 expect(viewer.shadowMap).toEqual({softShadows:false,maximumDistance:5000,darkness:.8});
 expect(viewer.scene.skyAtmosphere.show).toBe(true);
});
it('keeps the atmosphere on image failure and ignores image completion after disposal',()=>{
 const {viewer,unavailable,cleanup,image}=setup();
 image.dispatchEvent(new Event('error'));
 expect(unavailable).toHaveBeenCalledOnce();
 expect(viewer.scene.skyAtmosphere.show).toBe(true);
 cleanup();image.dispatchEvent(new Event('load'));
 expect(viewer.scene.primitives.add).not.toHaveBeenCalled();
});

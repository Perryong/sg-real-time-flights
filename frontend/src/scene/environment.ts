import {Cartesian3,Color,Credit,DirectionalLight,EquirectangularPanorama,Matrix4,Transforms,type Viewer} from 'cesium';

export const satelliteBackdrop={
 url:'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
 year:2024,
 credit:'<a href="https://maps.eox.at/">EOX Sentinel-2 cloudless 2024</a> · modified Copernicus Sentinel data · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>',
};

/** Photographic sky used by 3DStreet, not live weather. No second renderer. */
export function addFollowEnvironment(viewer:Viewer,lat:number,lon:number,onUnavailable:()=>void){
 let disposed=false,sky:EquirectangularPanorama|undefined;
 const previousLight=viewer.scene.light,previousShadows=viewer.shadows;
 const previousAtmosphere=viewer.scene.skyAtmosphere?.show;
 const previousShadowSettings={softShadows:viewer.shadowMap.softShadows,maximumDistance:viewer.shadowMap.maximumDistance,darkness:viewer.shadowMap.darkness};
 const transform=Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon,lat));
 const down=Matrix4.multiplyByPointAsVector(transform,new Cartesian3(0,0,-.7),new Cartesian3());
 const direction=new Cartesian3();
 const light=new DirectionalLight({direction:Cartesian3.clone(down),color:Color.fromCssColorString('#fff6e9'),intensity:1.8});
 viewer.scene.light=light;
 // Camera-side daylight keeps the inspected surfaces readable as the user orbits.
 const updateLight=()=>{Cartesian3.add(viewer.camera.directionWC,down,direction);Cartesian3.normalize(direction,light.direction)};
 updateLight();
 const removeLightUpdate=viewer.scene.preRender.addEventListener(updateLight);
 viewer.shadows=true;viewer.shadowMap.softShadows=true;viewer.shadowMap.maximumDistance=1500;viewer.shadowMap.darkness=.25;
 const image=new Image();
 image.onload=()=>{
  if(disposed||viewer.isDestroyed())return;
  sky=viewer.scene.primitives.add(new EquirectangularPanorama({transform,image,radius:3000000,
   credit:new Credit('<a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky">Sky: Poly Haven</a> · CC0 · via <a href="https://github.com/Perryong/3dstreet">3DStreet</a>')}));
  viewer.scene.skyAtmosphere!.show=false;
 };
 image.onerror=()=>{if(!disposed)onUnavailable()};
 image.src=`${import.meta.env.BASE_URL}environment/partly-cloudy-sky.jpg`;
 return ()=>{
  disposed=true;image.onload=null;image.onerror=null;removeLightUpdate();
  if(viewer.isDestroyed())return;
  if(sky)viewer.scene.primitives.remove(sky);
  viewer.scene.light=previousLight;viewer.shadows=previousShadows;
  Object.assign(viewer.shadowMap,previousShadowSettings);
  if(viewer.scene.skyAtmosphere&&previousAtmosphere!==undefined)viewer.scene.skyAtmosphere.show=previousAtmosphere;
 };
}

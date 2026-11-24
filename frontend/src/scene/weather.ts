import {Cartesian3, Color, Credit, GeometryInstance, Material, Matrix4, PolylineGeometry, PolylineMaterialAppearance, Primitive, PrimitiveCollection, Rectangle, SingleTileImageryProvider, Transforms, type ImageryLayer, type Viewer} from 'cesium';
import type {RadarFrame, WindStation} from '../data/weather';

// Meteorological bearings describe where wind comes FROM. The arrow and pulse
// travel away from that bearing, over a fixed 900 m station glyph.
const windMaterial = `
uniform vec4 color;
uniform float phase;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float shaft = (1.0 - step(0.76, st.s)) * (1.0 - step(0.14, abs(st.t - 0.5)));
  float head = step(0.76, st.s) * (1.0 - step((1.0 - st.s) * 2.08, abs(st.t - 0.5)));
  float pulse = step(0.0, phase) * (1.0 - smoothstep(0.025, 0.1, abs(st.s - phase)));
  material.diffuse = mix(color.rgb, vec3(1.0), pulse * 0.85);
  material.alpha = color.a * max(shaft, head);
  return material;
}`;

function windColor(speed:number):Color {
  return Color.fromCssColorString(speed < 2 ? '#74d8d2' : speed < 5 ? '#f3d37a' : '#f49b79');
}

export function addWindLayer(viewer:Viewer,stations:WindStation[],reducedMotion:boolean):()=>void {
  const collection = viewer.scene.primitives.add(new PrimitiveCollection());
  const animated:Array<{material:Material;speed:number}> = [];
  for (const station of stations) {
    const transform = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(station.lon,station.lat,25));
    const world = (east:number,north:number)=>Matrix4.multiplyByPoint(transform,new Cartesian3(east,north,0),new Cartesian3());
    const color = windColor(station.speed_mps);
    let positions:Cartesian3[];
    let material:Material;
    if (station.speed_mps === 0) {
      // A calm observation has no meaningful direction.
      positions = Array.from({length:24},(_,i)=>world(Math.sin(i*Math.PI/12)*90,Math.cos(i*Math.PI/12)*90));
      positions.push(Cartesian3.clone(positions[0]));
      material = Material.fromType('Color',{color});
    } else {
      const toward = (station.from_deg+180)*Math.PI/180;
      positions = [world(0,0),world(Math.sin(toward)*900,Math.cos(toward)*900)];
      material = new Material({fabric:{type:'StationWind',uniforms:{color,phase:reducedMotion?-1:0},source:windMaterial},translucent:true});
      if (!reducedMotion) animated.push({material,speed:station.speed_mps});
    }
    collection.add(new Primitive({
      geometryInstances:new GeometryInstance({geometry:new PolylineGeometry({positions,width:station.speed_mps===0?2:12,vertexFormat:PolylineMaterialAppearance.VERTEX_FORMAT})}),
      appearance:new PolylineMaterialAppearance({material}),
      allowPicking:false,
      asynchronous:false,
    }));
  }
  let previous = performance.now();
  const removeAnimation = animated.length ? viewer.scene.preUpdate.addEventListener(()=>{
    const now = performance.now();
    const elapsed = Math.min(100,Math.max(0,now-previous))/1000;
    previous = now;
    if (document.hidden) return;
    for (const {material,speed} of animated) {
      material.uniforms.phase = (material.uniforms.phase+elapsed*(0.1+Math.min(speed,30)*0.015))%1;
    }
  }) : ()=>{};
  let disposed = false;
  return ()=>{
    if (disposed) return;
    disposed = true;
    removeAnimation();
    if (!viewer.isDestroyed()) viewer.scene.primitives.remove(collection);
  };
}

export function addRadarLayer(viewer:Viewer,frame:RadarFrame,opacity:number,onError:()=>void):()=>void {
  let disposed = false;
  let layer:ImageryLayer|undefined;
  let removeError:(()=>void)|undefined;
  const cleanup = ()=>{
    if (disposed) return;
    disposed = true;
    removeError?.();
    if (layer && !viewer.isDestroyed()) viewer.imageryLayers.remove(layer,true);
  };
  const fail = ()=>{
    if (disposed || viewer.isDestroyed()) return;
    cleanup();
    onError();
  };
  void SingleTileImageryProvider.fromUrl(frame.url,{
    rectangle:Rectangle.fromDegrees(frame.west,frame.south,frame.east,frame.north),
    credit:new Credit('<a href="https://data.gov.sg/datasets/d_418e9ac3414fd927b7405631e0a7bc82/view">Rain radar: Meteorological Service Singapore / NEA</a>',true),
  }).then(provider=>{
    if (disposed || viewer.isDestroyed()) return;
    removeError = provider.errorEvent.addEventListener(fail);
    // Append to preserve the map style controls' fixed base imagery indices 0–2.
    layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = Math.max(0,Math.min(1,opacity));
  }).catch(fail);
  return cleanup;
}

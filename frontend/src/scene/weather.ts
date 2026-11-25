import {Cartesian3, Color, Credit, GeometryInstance, Material, Matrix4, PolylineGeometry, PolylineMaterialAppearance, Primitive, PrimitiveCollection, Rectangle, SingleTileImageryProvider, Transforms, type ImageryLayer, type Viewer} from 'cesium';
import type {RadarFrame, WindPoint, WindStation} from '../data/weather';

// Meteorological bearings describe where wind comes FROM. The arrow and pulse
// travel away from that bearing over the glyph's fixed geographic length.
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
  return addWindGlyphs(viewer,stations,reducedMotion,900,90);
}

export function addRegionalWindLayer(viewer:Viewer,points:WindPoint[],reducedMotion:boolean):()=>void {
  // Keep each sample anchored at its model coordinate, including at the edge
  // of the sampling circle. The symbol may extend beyond that circle.
  return addWindGlyphs(viewer,points,reducedMotion,20_000,2_000);
}

function addWindGlyphs(viewer:Viewer,points:WindPoint[],reducedMotion:boolean,arrowLength:number,calmRadius:number):()=>void {
  const collection = viewer.scene.primitives.add(new PrimitiveCollection());
  const animated:Array<{material:Material;speed:number}> = [];
  for (const point of points) {
    const transform = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(point.lon,point.lat,25));
    const world = (east:number,north:number)=>Matrix4.multiplyByPoint(transform,new Cartesian3(east,north,0),new Cartesian3());
    const color = windColor(point.speed_mps);
    let positions:Cartesian3[];
    let material:Material;
    if (point.speed_mps === 0) {
      // A calm wind has no meaningful direction.
      positions = Array.from({length:24},(_,i)=>world(Math.sin(i*Math.PI/12)*calmRadius,Math.cos(i*Math.PI/12)*calmRadius));
      positions.push(Cartesian3.clone(positions[0]));
      material = Material.fromType('Color',{color});
    } else {
      const toward = (point.from_deg+180)*Math.PI/180;
      positions = [world(0,0),world(Math.sin(toward)*arrowLength,Math.cos(toward)*arrowLength)];
      material = new Material({fabric:{type:'StationWind',uniforms:{color,phase:reducedMotion?-1:0},source:windMaterial},translucent:true});
      if (!reducedMotion) animated.push({material,speed:point.speed_mps});
    }
    collection.add(new Primitive({
      geometryInstances:new GeometryInstance({geometry:new PolylineGeometry({positions,width:point.speed_mps===0?2:12,vertexFormat:PolylineMaterialAppearance.VERTEX_FORMAT})}),
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

type RadarTarget = {
  frame:RadarFrame;
  opacity:number;
  onReady:(at:number|null)=>void;
  onError:()=>void;
};

export function createRadarLayerController(viewer:Viewer) {
  const cache = new Map<string,SingleTileImageryProvider>();
  let disposed = false;
  let target:RadarTarget|null = null;
  let pending:{url:string}|null = null;
  let visible:{url:string;layer:ImageryLayer;removeError:()=>void}|null = null;

  function removeVisible() {
    if (!visible) return;
    visible.removeError();
    if (!viewer.isDestroyed()) viewer.imageryLayers.remove(visible.layer,true);
    visible = null;
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    target = null;
    pending = null;
    removeVisible();
    // SingleTileImageryProvider has no destroy method. Dropping references lets
    // its decoded image be collected; destroying the layer releases GPU resources.
    cache.clear();
  }

  function fail() {
    if (disposed || viewer.isDestroyed() || !target) return;
    const failed = target;
    target = null;
    pending = null;
    removeVisible();
    failed.onReady(null);
    failed.onError();
  }

  function display(provider:SingleTileImageryProvider,current:RadarTarget) {
    const url = current.frame.url;
    cache.delete(url);
    cache.set(url,provider);
    if (cache.size > 13) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    if (visible?.url !== url) {
      // Remove first so there is never more than one radar layer, even during
      // collection events. Appending preserves base imagery indices 0–2.
      removeVisible();
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      const removeError = provider.errorEvent.addEventListener(()=>{
        cache.delete(url);
        fail();
      });
      visible = {url,layer,removeError};
    }
    visible.layer.alpha = current.opacity;
    current.onReady(current.frame.observed_at);
  }

  function show(frame:RadarFrame|null,opacity:number,onReady:(at:number|null)=>void,onError:()=>void) {
    if (disposed) return;
    if (viewer.isDestroyed()) {destroy();return;}
    if (!frame) {
      target = null;
      pending = null;
      removeVisible();
      onReady(null);
      return;
    }
    target = {frame,opacity:Math.max(0,Math.min(1,opacity)),onReady,onError};
    const cached = cache.get(frame.url);
    if (cached) {
      pending = null;
      display(cached,target);
      return;
    }
    // Opacity/callback changes share the in-flight image and use the latest
    // target when it resolves. Superseded loads never enter the decoded cache.
    if (pending?.url === frame.url) return;
    const load = {url:frame.url};
    pending = load;
    void SingleTileImageryProvider.fromUrl(frame.url,{
      rectangle:Rectangle.fromDegrees(frame.west,frame.south,frame.east,frame.north),
      credit:new Credit('<a href="https://data.gov.sg/datasets/d_418e9ac3414fd927b7405631e0a7bc82/view">Rain radar: Meteorological Service Singapore / NEA</a>',true),
    }).then(provider=>{
      if (disposed || pending !== load) return;
      if (viewer.isDestroyed()) {destroy();return;}
      pending = null;
      if (target) display(provider,target);
    },()=>{
      if (disposed || pending !== load) return;
      if (viewer.isDestroyed()) {destroy();return;}
      fail();
    });
  }

  return {show,destroy};
}

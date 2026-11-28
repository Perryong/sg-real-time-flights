// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Cartesian3, Cartographic, Event as CesiumEvent, ImageryLayerCollection, Math as CesiumMath, PrimitiveCollection, Resource, SingleTileImageryProvider} from 'cesium';
import type {RadarFrame, WindPoint, WindStation} from '../data/weather';
import {createRadarLayerController, addRadarLayer, addRegionalWindLayer, addWindLayer} from './weather';

const station:WindStation = {id:'S1',name:'Station',lat:1.35,lon:103.8,speed_mps:3,from_deg:0};
const frame:RadarFrame = {url:'https://www.weather.gov.sg/files/radar/radar.png',west:103.3,south:.8,east:104.5,north:1.9,observed_at:100,expires_at:9999999999};
function setup() {
  const primitives = new PrimitiveCollection();
  const imageryLayers = new ImageryLayerCollection();
  const viewer = {scene:{primitives,preUpdate:new CesiumEvent()},imageryLayers,isDestroyed:()=>false};
  return viewer;
}
function provider() {return new SingleTileImageryProvider({url:frame.url,tileWidth:512,tileHeight:512});}
beforeEach(()=>{vi.stubGlobal('ImageBitmap',class {});vi.stubGlobal('OffscreenCanvas',class {});vi.spyOn(document,'hidden','get').mockReturnValue(false);});
beforeEach(()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(this:HTMLCanvasElement){
    return {canvas:this,drawImage:vi.fn(),createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:vi.fn(),save:vi.fn(),scale:vi.fn(),createRadialGradient:()=>({addColorStop:vi.fn()}),
      fillRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),stroke:vi.fn(),restore:vi.fn()} as never;
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('station wind',()=>{
  it.each([{from:0,axis:'latitude',sign:-1},{from:90,axis:'longitude',sign:-1},{from:180,axis:'latitude',sign:1},{from:270,axis:'longitude',sign:1}])('points away from the reported $from degree source',({from,axis,sign})=>{
    const viewer=setup();
    const cleanup=addWindLayer(viewer as never,[{...station,from_deg:from}],true);
    const collection=viewer.scene.primitives.get(0);
    const arrow=collection.get(0);
    const positions=arrow.geometryInstances.geometry._positions;
    const start=Cartographic.fromCartesian(positions[0]);
    const end=Cartographic.fromCartesian(positions[1]);
    expect(CesiumMath.toDegrees(start.latitude)).toBeCloseTo(station.lat,5);
    expect(CesiumMath.toDegrees(start.longitude)).toBeCloseTo(station.lon,5);
    expect(start.height).toBeLessThan(50);
    expect(Cartesian3.distance(positions[0],positions[1])).toBeCloseTo(900,5);
    const delta=axis==='latitude'?end.latitude-start.latitude:end.longitude-start.longitude;
    expect(Math.sign(delta)).toBe(sign);
    expect(arrow.allowPicking).toBe(false);
    cleanup();
    expect(viewer.scene.primitives.length).toBe(0);
    expect(collection.isDestroyed()).toBe(true);
  });

  it('updates a bounded set of arrows, pauses hidden tabs and removes its animation listener',()=>{
    const viewer=setup();
    let now=0;
    vi.spyOn(performance,'now').mockImplementation(()=>now);
    const cleanup=addWindLayer(viewer as never,[station],false);
    const collection=viewer.scene.primitives.get(0);
    const uniforms=collection.get(0).appearance.material.uniforms;
    const initial=uniforms.phase;
    now=100;viewer.scene.preUpdate.raiseEvent();
    expect(uniforms.phase).toBeGreaterThan(initial);
    const visiblePhase=uniforms.phase;
    vi.spyOn(document,'hidden','get').mockReturnValue(true);
    now=200;viewer.scene.preUpdate.raiseEvent();
    expect(uniforms.phase).toBe(visiblePhase);
    expect(collection.length).toBe(1);
    cleanup();cleanup();
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    expect(viewer.scene.primitives.length).toBe(0);
  });

  it('keeps reduced-motion and calm station glyphs static without an animation listener',()=>{
    const viewer=setup();
    const cleanup=addWindLayer(viewer as never,[station,{...station,id:'calm',speed_mps:0}],true);
    const collection=viewer.scene.primitives.get(0);
    expect(collection.length).toBe(2);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    const calm=collection.get(1).geometryInstances.geometry._positions;
    expect(calm.length).toBeGreaterThan(8);
    expect(calm[0]).toEqual(calm[calm.length-1]);
    expect(Cartesian3.distance(Cartesian3.fromDegrees(station.lon,station.lat,25),calm[0])).toBeCloseTo(90,5);
    cleanup();
  });

  it('does not install animation for empty or entirely calm observations',()=>{
    for (const stations of [[],[{...station,speed_mps:0}]]) {
      const viewer=setup();
      const cleanup=addWindLayer(viewer as never,stations,false);
      expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
      cleanup();
    }
  });
});

describe('regional model wind',()=>{
  const point:WindPoint={id:'regional-1',lat:1.3644,lon:103.9915,speed_mps:3,from_deg:0};

  it.each([{from:0,axis:'latitude',sign:-1},{from:90,axis:'longitude',sign:-1},{from:180,axis:'latitude',sign:1},{from:270,axis:'longitude',sign:1}])('draws a 20km arrow away from the $from degree source',({from,axis,sign})=>{
    const viewer=setup();
    const {destroy:cleanup}=addRegionalWindLayer(viewer as never,[{...point,from_deg:from}],true);
    const arrow=viewer.scene.primitives.get(0).get(0);
    const positions=arrow.geometryInstances.geometry._positions;
    const start=Cartographic.fromCartesian(positions[0]);
    const end=Cartographic.fromCartesian(positions[1]);
    expect(CesiumMath.toDegrees(start.latitude)).toBeCloseTo(point.lat,5);
    expect(CesiumMath.toDegrees(start.longitude)).toBeCloseTo(point.lon,5);
    expect(Cartesian3.distance(positions[0],positions[1])).toBeCloseTo(20_000,5);
    expect(Math.sign(axis==='latitude'?end.latitude-start.latitude:end.longitude-start.longitude)).toBe(sign);
    expect(arrow.allowPicking).toBe(false);
    expect(arrow.appearance.material.uniforms.phase).toBe(-1);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    cleanup();
  });

  it('preserves the exact model coordinate anchor at the sampling boundary',()=>{
    // Approximately 500km north: glyph extent does not relocate the model sample.
    const edge=Object.freeze({...point,lat:5.86100181862269,from_deg:180});
    const viewer=setup();
    const {destroy:cleanup}=addRegionalWindLayer(viewer as never,[edge],true);
    const positions=viewer.scene.primitives.get(0).get(0).geometryInstances.geometry._positions;
    expect(Cartesian3.distance(positions[0],Cartesian3.fromDegrees(edge.lon,edge.lat,25))).toBeLessThan(1e-6);
    expect(Cartesian3.distance(positions[0],positions[1])).toBeCloseTo(20_000,5);
    cleanup();
  });

  it('renders a static non-pickable 2km calm ring centered at its model point',()=>{
    const viewer=setup();
    const {destroy:cleanup}=addRegionalWindLayer(viewer as never,[{...point,speed_mps:0}],false);
    const glyph=viewer.scene.primitives.get(0).get(0);
    const positions:Cartesian3[]=glyph.geometryInstances.geometry._positions;
    const center=Cartesian3.fromDegrees(point.lon,point.lat,25);
    expect(positions).toHaveLength(25);
    expect(positions[0]).toEqual(positions[24]);
    for(const vertex of positions) expect(Cartesian3.distance(center,vertex)).toBeCloseTo(2_000,5);
    expect(glyph.allowPicking).toBe(false);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    cleanup();
  });

  it('shares one animation listener, pauses when hidden, and destroys its glyphs on cleanup',()=>{
    const viewer=setup();
    let now=0;
    vi.spyOn(performance,'now').mockImplementation(()=>now);
    const {destroy:cleanup}=addRegionalWindLayer(viewer as never,[point,{...point,id:'fast',speed_mps:10}],false);
    const collection=viewer.scene.primitives.get(0);
    const slow=collection.get(0).appearance.material.uniforms;
    const fast=collection.get(1).appearance.material.uniforms;
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(1);
    now=100;viewer.scene.preUpdate.raiseEvent();
    expect(slow.phase).toBeGreaterThan(0);
    expect(fast.phase).toBeGreaterThan(slow.phase);
    const phase=slow.phase;
    vi.spyOn(document,'hidden','get').mockReturnValue(true);
    now=200;viewer.scene.preUpdate.raiseEvent();
    expect(slow.phase).toBe(phase);
    cleanup();cleanup();
    expect(collection.isDestroyed()).toBe(true);
    expect(viewer.scene.primitives.length).toBe(0);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
  });

  it('creates no glyphs or animation for absent model points',()=>{
    const viewer=setup();
    const {destroy:cleanup}=addRegionalWindLayer(viewer as never,[],false);
    expect(viewer.scene.primitives.length).toBe(0);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    cleanup();
  });

  const cell:WindPoint[]=[0,1].flatMap(row=>[0,1].map(col=>({
    id:`regional:${row}:${col}`,lat:1.3+row*1.1,lon:103.9+col*1.1,speed_mps:7,from_deg:45,
  })));

  function setupShade(){
    vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,AA');
    const viewer=setup();
    for(let i=0;i<3;i++)viewer.imageryLayers.addImageryProvider(provider());
    return viewer;
  }

  it('draws shading under an existing radar layer and lightens wind without reallocating',()=>{
    const viewer=setupShade();
    const radar=viewer.imageryLayers.addImageryProvider(provider());
    const wind=addRegionalWindLayer(viewer as never,cell,true);
    const shade=viewer.imageryLayers.get(3);
    const arrows=viewer.scene.primitives.get(0);
    expect(viewer.imageryLayers.get(4)).toBe(radar);
    expect(arrows.allowPicking).toBe(false);
    expect(arrows.appearance.material.uniforms.phase).toBe(-1);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    const normalAlpha=shade.alpha;
    const normalArrowAlpha=arrows.appearance.material.uniforms.color.alpha;
    wind.setRadarVisible(true);
    expect(shade.alpha).toBeLessThan(normalAlpha);
    expect(arrows.appearance.material.uniforms.color.alpha).toBeLessThan(normalArrowAlpha);
    wind.setRadarVisible(false);
    expect(viewer.imageryLayers.get(3)).toBe(shade);
    expect(shade.alpha).toBe(normalAlpha);
    wind.destroy();wind.destroy();
    expect(viewer.imageryLayers.get(3)).toBe(radar);
    expect(shade.isDestroyed()).toBe(true);
    expect(arrows.isDestroyed()).toBe(true);
  });

  it('animates one bounded primitive, pauses while hidden and removes animation on destroy',()=>{
    const viewer=setupShade();
    let now=0;
    vi.spyOn(performance,'now').mockImplementation(()=>now);
    const wind=addRegionalWindLayer(viewer as never,cell,false);
    expect(viewer.scene.primitives.length).toBe(1);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(1);
    const uniforms=viewer.scene.primitives.get(0).appearance.material.uniforms;
    now=100;viewer.scene.preUpdate.raiseEvent();
    expect(uniforms.phase).toBeGreaterThan(0);
    const visiblePhase=uniforms.phase;
    vi.spyOn(document,'hidden','get').mockReturnValue(true);
    now=200;viewer.scene.preUpdate.raiseEvent();
    expect(uniforms.phase).toBe(visiblePhase);
    wind.destroy();
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    expect(viewer.scene.primitives.length).toBe(0);
  });
});

async function flush() {for(let i=0;i<8;i++)await Promise.resolve();}

describe('rain radar',()=>{
  it('maps geographic bounds, appends after base imagery and removes only its own layer',async()=>{
    const viewer=setup();
    for(let i=0;i<3;i++)viewer.imageryLayers.addImageryProvider(provider());
    const bases=[0,1,2].map(i=>viewer.imageryLayers.get(i));
    vi.spyOn(Resource.prototype,'fetchImage').mockResolvedValue(new Image(64,64));
    const cleanup=addRadarLayer(viewer as never,frame,.4,vi.fn());
    await flush();
    expect(viewer.imageryLayers.length).toBe(4);
    expect(viewer.imageryLayers.get(3).alpha).toBe(.4);
    const loaded=viewer.imageryLayers.get(3).imageryProvider;
    const rectangle=loaded.rectangle;
    expect(rectangle).toBeDefined();
    expect(CesiumMath.toDegrees(rectangle!.west)).toBeCloseTo(103.3);
    expect(CesiumMath.toDegrees(rectangle!.north)).toBeCloseTo(1.9);
    expect(loaded.credit).toBeTruthy();
    cleanup();cleanup();
    expect([0,1,2].map(i=>viewer.imageryLayers.get(i))).toEqual(bases);
    expect(viewer.imageryLayers.length).toBe(3);
    expect(loaded.errorEvent.numberOfListeners).toBe(0);
  });

  it('does not add imagery when its request completes after cleanup',async()=>{
    const viewer=setup();
    let resolve!:(value:HTMLImageElement)=>void;
    vi.spyOn(Resource.prototype,'fetchImage').mockReturnValue(new Promise(done=>{resolve=done;}));
    const cleanup=addRadarLayer(viewer as never,frame,.5,vi.fn());
    cleanup();resolve(new Image(64,64));await flush();
    expect(viewer.imageryLayers.length).toBe(0);
  });

  it('reports initial download failure once',async()=>{
    const viewer=setup(),onError=vi.fn();
    vi.spyOn(Resource.prototype,'fetchImage').mockRejectedValue(new Error('denied'));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    await flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(viewer.imageryLayers.length).toBe(0);
    cleanup();
  });

  it('removes failed imagery and its error listener',async()=>{
    const viewer=setup(),onError=vi.fn();
    vi.spyOn(Resource.prototype,'fetchImage').mockResolvedValue(new Image(64,64));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    await flush();
    const loaded=viewer.imageryLayers.get(0).imageryProvider;
    loaded.errorEvent.raiseEvent(new Error('unavailable'));
    expect(viewer.imageryLayers.length).toBe(0);
    expect(loaded.errorEvent.numberOfListeners).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
    cleanup();
  });

  it('ignores pending rejection after disposal',async()=>{
    const viewer=setup(),onError=vi.fn();
    let reject!:(error:Error)=>void;
    vi.spyOn(Resource.prototype,'fetchImage').mockReturnValue(new Promise((_,fail)=>{reject=fail;}));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    cleanup();reject(new Error('late error'));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(viewer.imageryLayers.length).toBe(0);
  });

  it('ignores completion after Cesium itself is destroyed',async()=>{
    const viewer=setup(),onError=vi.fn();
    vi.spyOn(Resource.prototype,'fetchImage').mockResolvedValue(new Image(64,64));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    viewer.isDestroyed=()=>true;
    await flush();
    expect(viewer.imageryLayers.length).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    cleanup();
  });
});


describe('radar playback controller',()=>{
  function snapshot(at:number):RadarFrame {return {...frame,url:`https://www.weather.gov.sg/files/radar/${at}.png`,observed_at:at};}
  function downloads() {
    const requests:Array<{url:string;resolve:(image:HTMLImageElement)=>void;reject:(error:Error)=>void}>=[];
    vi.spyOn(Resource.prototype,'fetchImage').mockImplementation(function(this:Resource){
      return new Promise<HTMLImageElement>((resolve,reject)=>requests.push({url:this.url,resolve,reject}));
    });
    const finish=async(index:number)=>{
      const image=new Image(512,512);
      requests[index].resolve(image);
      await flush();
      return image;
    };
    return {requests,finish};
  }
  function radarProvider(viewer:ReturnType<typeof setup>,index=0) {
    const loaded=viewer.imageryLayers.get(index).imageryProvider;
    if (!(loaded instanceof SingleTileImageryProvider)) throw new Error('Expected single tile radar');
    return loaded;
  }
  function withBases() {
    const viewer=setup();
    for(let i=0;i<3;i++)viewer.imageryLayers.addImageryProvider(provider());
    return viewer;
  }

  it('keeps the previous image until replacement loads and reports only the installed timestamp',async()=>{
    const viewer=withBases(),network=downloads(),ready=vi.fn(),error=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    const bases=[0,1,2].map(i=>viewer.imageryLayers.get(i));
    const counts:number[]=[];
    viewer.imageryLayers.layerAdded.addEventListener(()=>counts.push(viewer.imageryLayers.length));
    controller.show(snapshot(100),.4,ready,error);
    expect(ready).not.toHaveBeenCalled();
    await network.finish(0);
    const old=viewer.imageryLayers.get(3),oldProvider=old.imageryProvider;
    expect(await oldProvider.requestImage(0,0,0)).toBeInstanceOf(HTMLCanvasElement);
    expect(old.alpha).toBe(.4);
    expect(CesiumMath.toDegrees(oldProvider.rectangle.west)).toBeCloseTo(103.3);
    expect(oldProvider.credit).toBeTruthy();
    expect(ready.mock.calls).toEqual([[100]]);
    controller.show(snapshot(200),.7,ready,error);
    expect(viewer.imageryLayers.get(3)).toBe(old);
    expect(ready.mock.calls).toEqual([[100]]);
    await network.finish(1);
    expect(radarProvider(viewer,3).url).toContain('/200.png');
    expect(viewer.imageryLayers.get(3).alpha).toBe(.7);
    expect(old.isDestroyed()).toBe(true);
    expect(oldProvider.errorEvent.numberOfListeners).toBe(0);
    expect(ready.mock.calls).toEqual([[100],[200]]);
    expect(Math.max(...counts)).toBe(4);
    controller.destroy();controller.destroy();
    expect([0,1,2].map(i=>viewer.imageryLayers.get(i))).toEqual(bases);
    expect(viewer.imageryLayers.length).toBe(3);
  });

  it('reuses pending and displayed frames for opacity updates and delivers the latest callback',async()=>{
    const viewer=setup(),network=downloads(),first=vi.fn(),latest=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    controller.show(snapshot(100),.2,first,vi.fn());
    controller.show(snapshot(100),1.5,latest,vi.fn());
    expect(network.requests).toHaveLength(1);
    await network.finish(0);
    expect(first).not.toHaveBeenCalled();
    expect(latest.mock.calls).toEqual([[100]]);
    const layer=viewer.imageryLayers.get(0);
    expect(layer.alpha).toBe(1);
    controller.show(snapshot(100),-.5,latest,vi.fn());
    expect(layer.alpha).toBe(0);
    expect(viewer.imageryLayers.get(0)).toBe(layer);
    expect(network.requests).toHaveLength(1);
    controller.destroy();
  });

  it('ignores out-of-order loads and does not cache canceled downloads',async()=>{
    const viewer=setup(),network=downloads(),oldReady=vi.fn(),ready=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    controller.show(snapshot(100),.5,oldReady,vi.fn());
    controller.show(snapshot(200),.5,ready,vi.fn());
    await network.finish(1);await network.finish(0);
    expect(oldReady).not.toHaveBeenCalled();
    expect(ready.mock.calls).toEqual([[200]]);
    expect(viewer.imageryLayers.length).toBe(1);
    expect(radarProvider(viewer).url).toContain('/200.png');
    controller.show(snapshot(100),.5,ready,vi.fn());
    expect(network.requests).toHaveLength(3);
    controller.destroy();await network.finish(2);
    expect(viewer.imageryLayers.length).toBe(0);
  });

  it.each(['clear','destroy','viewer destroyed'])('invalidates pending completion on %s',async(action)=>{
    const viewer=setup(),network=downloads(),ready=vi.fn(),error=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    controller.show(snapshot(100),.5,ready,error);
    if(action==='clear')controller.show(null,.5,ready,error);
    else if(action==='destroy')controller.destroy();
    else viewer.isDestroyed=()=>true;
    await network.finish(0);
    expect(viewer.imageryLayers.length).toBe(0);
    expect(ready.mock.calls).toEqual(action==='clear'?[[null]]:[]);
    expect(error).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('clears visible imagery and signals null before a target load error',async()=>{
    const viewer=setup(),network=downloads(),events:Array<number|string|null>=[];
    const controller=createRadarLayerController(viewer as never);
    const ready=(at:number|null)=>events.push(at),error=()=>events.push('error');
    controller.show(snapshot(100),.5,ready,error);await network.finish(0);
    const old=viewer.imageryLayers.get(0).imageryProvider;
    controller.show(snapshot(200),.5,ready,error);
    network.requests[1].reject(new Error('offline'));await flush();
    expect(events).toEqual([100,null,'error']);
    expect(viewer.imageryLayers.length).toBe(0);
    expect(old.errorEvent.numberOfListeners).toBe(0);
    controller.destroy();
  });

  it('removes failed providers from the cache and detaches all visible listeners',async()=>{
    const viewer=setup(),network=downloads(),ready=vi.fn(),error=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    controller.show(snapshot(100),.5,ready,error);await network.finish(0);
    const loaded=viewer.imageryLayers.get(0).imageryProvider;
    loaded.errorEvent.raiseEvent(new Error('tile failed'));
    expect(viewer.imageryLayers.length).toBe(0);
    expect(ready.mock.calls).toEqual([[100],[null]]);
    expect(error).toHaveBeenCalledOnce();
    expect(loaded.errorEvent.numberOfListeners).toBe(0);
    controller.show(snapshot(100),.5,ready,error);
    expect(network.requests).toHaveLength(2);
    controller.destroy();network.requests[1].reject(new Error('late failure'));await flush();
    expect(error).toHaveBeenCalledOnce();
  });

  it('switches cached frames synchronously and evicts the least recently used of thirteen decoded providers',async()=>{
    const viewer=setup(),network=downloads(),ready=vi.fn(),error=vi.fn();
    const controller=createRadarLayerController(viewer as never);
    for(let i=0;i<13;i++) {
      controller.show(snapshot(i*300),.5,ready,error);
      await network.finish(i);
    }
    controller.show(snapshot(0),.3,ready,error);
    expect(ready).toHaveBeenLastCalledWith(0);
    expect(radarProvider(viewer).url).toContain('/0.png');
    expect(viewer.imageryLayers.get(0).alpha).toBe(.3);
    expect(network.requests).toHaveLength(13);
    controller.show(snapshot(3900),.5,ready,error);await network.finish(13);
    controller.show(snapshot(0),.5,ready,error);
    expect(network.requests).toHaveLength(14);
    controller.show(snapshot(300),.5,ready,error);
    expect(network.requests).toHaveLength(15);
    const current=viewer.imageryLayers.get(0).imageryProvider;
    controller.show(null,.5,ready,error);
    expect(current.errorEvent.numberOfListeners).toBe(0);
    expect(viewer.imageryLayers.length).toBe(0);
    expect(ready).toHaveBeenLastCalledWith(null);
    controller.destroy();await network.finish(14);
  });
});

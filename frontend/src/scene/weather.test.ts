// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Cartesian3, Cartographic, Event as CesiumEvent, ImageryLayerCollection, Math as CesiumMath, PrimitiveCollection, SingleTileImageryProvider} from 'cesium';
import type {RadarFrame, WindPoint, WindStation} from '../data/weather';
import {addRadarLayer, addRegionalWindLayer, addWindLayer} from './weather';

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
    const cleanup=addRegionalWindLayer(viewer as never,[{...point,from_deg:from}],true);
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
    const cleanup=addRegionalWindLayer(viewer as never,[edge],true);
    const positions=viewer.scene.primitives.get(0).get(0).geometryInstances.geometry._positions;
    expect(Cartesian3.distance(positions[0],Cartesian3.fromDegrees(edge.lon,edge.lat,25))).toBeLessThan(1e-6);
    expect(Cartesian3.distance(positions[0],positions[1])).toBeCloseTo(20_000,5);
    cleanup();
  });

  it('renders a static non-pickable 2km calm ring centered at its model point',()=>{
    const viewer=setup();
    const cleanup=addRegionalWindLayer(viewer as never,[{...point,speed_mps:0}],false);
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
    const cleanup=addRegionalWindLayer(viewer as never,[point,{...point,id:'fast',speed_mps:10}],false);
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
    const cleanup=addRegionalWindLayer(viewer as never,[],false);
    expect(viewer.scene.primitives.get(0).length).toBe(0);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    cleanup();
  });
});

describe('rain radar',()=>{
  it('maps geographic bounds, appends after base imagery and removes only its own layer',async()=>{
    const viewer=setup();
    for(let i=0;i<3;i++)viewer.imageryLayers.addImageryProvider(provider());
    const bases=[0,1,2].map(i=>viewer.imageryLayers.get(i));
    const loaded=provider();
    const load=vi.spyOn(SingleTileImageryProvider,'fromUrl').mockResolvedValue(loaded);
    const cleanup=addRadarLayer(viewer as never,frame,.4,vi.fn());
    await Promise.resolve();
    expect(viewer.imageryLayers.length).toBe(4);
    expect(viewer.imageryLayers.get(3).alpha).toBe(.4);
    expect(load.mock.calls[0][0]).toBe(frame.url);
    const rectangle=load.mock.calls[0][1]?.rectangle;
    expect(rectangle).toBeDefined();
    expect(CesiumMath.toDegrees(rectangle!.west)).toBeCloseTo(103.3);
    expect(CesiumMath.toDegrees(rectangle!.north)).toBeCloseTo(1.9);
    expect(load.mock.calls[0][1]?.credit).toBeTruthy();
    cleanup();cleanup();
    expect([0,1,2].map(i=>viewer.imageryLayers.get(i))).toEqual(bases);
    expect(viewer.imageryLayers.length).toBe(3);
    expect(loaded.errorEvent.numberOfListeners).toBe(0);
  });

  it('does not add imagery when its request completes after cleanup',async()=>{
    const viewer=setup();
    let resolve!:(value:SingleTileImageryProvider)=>void;
    vi.spyOn(SingleTileImageryProvider,'fromUrl').mockReturnValue(new Promise(done=>{resolve=done;}));
    const cleanup=addRadarLayer(viewer as never,frame,.5,vi.fn());
    cleanup();resolve(provider());await Promise.resolve();
    expect(viewer.imageryLayers.length).toBe(0);
  });

  it('reports initial download failure once',async()=>{
    const viewer=setup(),onError=vi.fn();
    vi.spyOn(SingleTileImageryProvider,'fromUrl').mockRejectedValue(new Error('denied'));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    await Promise.resolve();await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(viewer.imageryLayers.length).toBe(0);
    cleanup();
  });

  it('removes failed imagery and its error listener',async()=>{
    const viewer=setup(),onError=vi.fn(),loaded=provider();
    vi.spyOn(SingleTileImageryProvider,'fromUrl').mockResolvedValue(loaded);
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    await Promise.resolve();
    loaded.errorEvent.raiseEvent(new Error('unavailable'));
    expect(viewer.imageryLayers.length).toBe(0);
    expect(loaded.errorEvent.numberOfListeners).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
    cleanup();
  });

  it('ignores pending rejection after disposal',async()=>{
    const viewer=setup(),onError=vi.fn();
    let reject!:(error:Error)=>void;
    vi.spyOn(SingleTileImageryProvider,'fromUrl').mockReturnValue(new Promise((_,fail)=>{reject=fail;}));
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    cleanup();reject(new Error('late error'));
    await Promise.resolve();await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(viewer.imageryLayers.length).toBe(0);
  });

  it('ignores completion after Cesium itself is destroyed',async()=>{
    const viewer=setup(),onError=vi.fn();
    vi.spyOn(SingleTileImageryProvider,'fromUrl').mockResolvedValue(provider());
    const cleanup=addRadarLayer(viewer as never,frame,.5,onError);
    viewer.isDestroyed=()=>true;
    await Promise.resolve();
    expect(viewer.imageryLayers.length).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    cleanup();
  });
});

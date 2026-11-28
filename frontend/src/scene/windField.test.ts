import {describe, expect, it} from 'vitest';
import type {WindPoint} from '../data/weather';
import {buildWindField, rasterWindField, regionalWindBounds, sampleWind, windPaths, withinWindRegion} from './windField';

const point=(north:number,east:number,lat:number,lon:number,from_deg=45,speed_mps=7):WindPoint=>
  ({id:`regional:${north}:${east}`,lat,lon,from_deg,speed_mps});
const cell=[point(0,0,1.3,103.9),point(0,1,1.28,105.04),point(1,0,2.45,103.96),point(1,1,2.42,105.12)];

describe('regional wind field',()=>{
  it('uses the actual model coordinates and follows a northeasterly wind southwest',()=>{
    const field=buildWindField(cell);
    expect(sampleWind(field,103.92,2.4)).toBeUndefined();
    const wind=sampleWind(field,104.5,1.9)!;
    expect(wind.east).toBeCloseTo(-Math.sqrt(24.5));
    expect(wind.north).toBeCloseTo(-Math.sqrt(24.5));
    const paths=windPaths(field);
    expect(paths.length).toBeGreaterThan(1);
    for(const path of paths){
      expect(path.at(-1)!.lon).toBeLessThan(path[0].lon);
      expect(path.at(-1)!.lat).toBeLessThan(path[0].lat);
    }
  });

  it('interpolates components through north and does not invent wind when vectors cancel',()=>{
    const [sw,se,nw,ne]=cell;
    const middleLon=(sw.lon+se.lon+nw.lon+ne.lon)/4;
    const middleLat=(sw.lat+se.lat+nw.lat+ne.lat)/4;
    const wrapped=buildWindField(cell.map((p,i)=>({...p,from_deg:i%2===0?359:1})));
    expect(sampleWind(wrapped,middleLon,middleLat)!.east).toBeCloseTo(0);
    expect(sampleWind(wrapped,middleLon,middleLat)!.north).toBeCloseTo(-7);
    const opposed=buildWindField(cell.map((p,i)=>({...p,from_deg:i%2===0?0:180})));
    expect(Math.hypot(...Object.values(sampleWind(opposed,middleLon,middleLat)!))).toBeCloseTo(0);
  });

  it('leaves a missing-corner cell and a gap in the grid clear while preserving isolated glyphs',()=>{
    const [sw,se,nw]=cell;
    const isolated=point(1,2,2.42,105.12);
    const unsupported=buildWindField([sw,se,nw,isolated]);
    expect(sampleWind(unsupported,104.5,1.9)).toBeUndefined();
    expect(unsupported.isolated).toEqual([sw,se,nw,isolated]);
    expect(rasterWindField(unsupported,128).every(v=>v===0)).toBe(true);
    expect(buildWindField([...cell,isolated]).isolated).toEqual([isolated]);
  });

  it('paints covered calm water in the low-speed color and leaves unsupported areas transparent',()=>{
    const field=buildWindField(cell.map(p=>({...p,speed_mps:0})));
    expect(windPaths(field)).toEqual([]);
    const pixels=rasterWindField(field,128);
    expect(pixelAt(pixels,128,104.5,1.9)).toEqual([0x17,0x67,0xa0,255]);
    expect(pixelAt(pixels,128,103.5,1.9)).toEqual([0,0,0,0]);
  });

  it('clips a boundary cell and its trails to the 500 km circle',()=>{
    const field=buildWindField([point(3,0,4.8,104),point(3,1,4.8,105.1),point(4,0,5.9,104),point(4,1,5.9,105.1)]);
    expect(sampleWind(field,104.1,5.2)).toBeDefined();
    expect(sampleWind(field,105.05,5.78)).toBeUndefined();
    const pixels=rasterWindField(field,256);
    expect(pixelAt(pixels,256,104.1,5.2)[3]).toBe(255);
    expect(pixelAt(pixels,256,105.05,5.78)[3]).toBe(0);
    expect(windPaths(field).flat().every(({lon,lat})=>withinWindRegion(lon,lat))).toBe(true);
  });

  it('caps trail count at six per covered cell',()=>{
    const grid=Array.from({length:49},(_,i)=>{
      const north=Math.floor(i/7)-3, east=i%7-3;
      return point(north,east,1.3644+north*1.125,103.9915+east*1.125);
    });
    const paths=windPaths(buildWindField(grid));
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.length).toBeLessThanOrEqual(6*36);
  });

  it.each([{speed:2,rgb:[36,168,173]},{speed:5,rgb:[145,209,139]},{speed:22,rgb:[255,227,148]}])(
    'uses the expected scale color at $speed m/s',({speed,rgb})=>{
      const field=buildWindField(cell.map(p=>({...p,speed_mps:speed})));
      expect(pixelAt(rasterWindField(field,64),64,104.5,1.9)).toEqual([...rgb,255]);
    },
  );
});

function pixelAt(pixels:Uint8ClampedArray,size:number,lon:number,lat:number){
  const {west,south,east,north}=regionalWindBounds;
  const x=Math.floor((lon-west)/(east-west)*size);
  const y=Math.floor((north-lat)/(north-south)*size);
  const at=(y*size+x)*4;
  return [...pixels.slice(at,at+4)];
}

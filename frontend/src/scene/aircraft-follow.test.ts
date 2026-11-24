// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {EntityCollection,JulianDate,Cartesian3} from 'cesium';
import {AircraftLayer} from './aircraft';
import {track} from '../data/testHelpers';
it('keeps the followed model visible at cruise altitude and holds its last valid pose',()=>{
 let now=1020;
 const viewer={entities:new EntityCollection(),camera:{positionCartographic:{height:13000}},scene:{primitives:{add:(x:unknown)=>x,remove:()=>true}}};
 const layer=new AircraftLayer(viewer as never,()=>now);
 const t=track([1000,1020]);for(const o of t.history)o.alt_geom_m=12500;t.latest=t.history[1];
 layer.update([t],t.id,true,false,t.id);
 const entity=layer.entities.get(t.id)!;
 const pose=entity.position!.getValue(JulianDate.now())!;
 expect(entity.model!.show!.getValue(JulianDate.now())).toBe(true);
 expect(layer.followFrame?.altitude).toBe(12500);
 now=1041;t.latest={...t.latest,lat:5,lon:99,alt_geom_m:5000};
 layer.update([t],t.id,true,false,t.id);
 expect(Cartesian3.equals(entity.position!.getValue(JulianDate.now()),pose)).toBe(true);
 layer.update([t],t.id,true,false,null);
 expect(layer.followFrame).toBeNull();
 expect(entity.model!.show!.getValue(JulianDate.now())).toBe(false);
 layer.clear();
});
it('selects the reported variant and switches to the generic mesh on asset failure',()=>{
 const viewer={entities:new EntityCollection(),camera:{positionCartographic:{height:1000}},scene:{primitives:{add:(x:unknown)=>x,remove:()=>true}}};
 const layer=new AircraftLayer(viewer as never,()=>1000),t=track([1000]);t.latest.aircraft_type='A359';
 layer.update([t],t.id,true,false,t.id);
 const uri=()=>layer.entities.get(t.id)!.model!.uri!.getValue(JulianDate.now());
 expect(uri()).toContain('airbus-a350-900.glb');
 layer.unavailableModels.add('airbus-a350-900.glb');expect(uri()).toContain('generic-aircraft.glb');
 t.latest.aircraft_type='B77W';expect(uri()).toContain('boeing-777-300er.glb');
 layer.clear();
});

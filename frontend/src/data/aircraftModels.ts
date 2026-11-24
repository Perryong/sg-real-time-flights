export interface AircraftModel {file:string;name:string;specific:boolean}
const models:Record<string,AircraftModel>={
 A359:{file:'airbus-a350-900.glb',name:'Airbus A350-900',specific:true},
 A35K:{file:'airbus-a350-1000.glb',name:'Airbus A350-1000',specific:true},
 B77L:{file:'boeing-777-200lr.glb',name:'Boeing 777-200LR',specific:true},
 B77W:{file:'boeing-777-300er.glb',name:'Boeing 777-300ER',specific:true},
};
export const modelFiles=['generic-aircraft.glb',...Object.values(models).map(m=>m.file)];
export function aircraftModel(type:string|null|undefined):AircraftModel{
 return models[type?.trim().toUpperCase()??'']??{file:'generic-aircraft.glb',name:'Generic aircraft',specific:false};
}

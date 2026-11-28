export interface AircraftModel {file:string;name:string;specific:boolean;credit:string}
const polyforkCredit = 'Approximate Polyfork adaptation';
const models:Record<string,AircraftModel>={
 A320:{file:'airbus-a320-200.glb',name:'Airbus A320-200',specific:true,credit:'Model by Airbus5717 · CC BY-NC 4.0'},
 A359:{file:'airbus-a350-900.glb',name:'Airbus A350-900',specific:true,credit:polyforkCredit},
 A35K:{file:'airbus-a350-1000.glb',name:'Airbus A350-1000',specific:true,credit:polyforkCredit},
 B77L:{file:'boeing-777-200lr.glb',name:'Boeing 777-200LR',specific:true,credit:polyforkCredit},
 B77W:{file:'boeing-777-300er.glb',name:'Boeing 777-300ER',specific:true,credit:polyforkCredit},
};
export const modelFiles=['generic-aircraft.glb',...Object.values(models).map(m=>m.file)];
export function aircraftModel(type:string|null|undefined):AircraftModel{
 return models[type?.trim().toUpperCase()??'']??{file:'generic-aircraft.glb',name:'Generic aircraft',specific:false,credit:'Generic fallback model'};
}

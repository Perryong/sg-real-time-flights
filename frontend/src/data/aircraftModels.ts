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

// Airliner ICAO designators and unambiguous family codes used by feeds.
const airlinerTypes = new Set(`
  A300 A330 A340 A350 A380 B707 B727 B747 B757 B767 B777 B787
  A20N A21N A19N A306 A30B A310 A318 A319 A320 A321 A332 A333 A338 A339 A342 A343 A345 A346 A359 A35K A388
  B703 B712 B720 B721 B722 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM
  B741 B742 B743 B744 B748 B74D B74R B74S B752 B753 B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X
  BCS1 BCS3 RJ70 RJ85 RJ1H B461 B462 B463 CRJ1 CRJ2 CRJ7 CRJ9 CRJX E110 E120 E135 E145 E170 E175 E75L E75S
  E190 E195 E290 E295 AT42 AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 AT77 DH8A DH8B DH8C DH8D DHC6 DHC7
  C909 C919 AJ27 SU95 F27 F28 F50 F70 F100 SB20 SF34 JS31 JS32 JS41 D328 J328 ATP B190
  MD11 MD81 MD82 MD83 MD87 MD88 MD90 DC10 DC93 DC94 DC95 DC91 DC92 L101 BLCF A3ST A337
  AN12 A124 A140 AN24 AN26 AN28 AN32 AN72 AN74 A148 A158 IL62 IL76 IL86 IL96 T134 T154 T204 T214 YK40 YK42
  BA11 CL44 DC3 DC4 DC6 DC7 DC85 DC86 DC87 DC8F L188 YS11 N262 S210 SH33 SH36 HS74 F60 MA60 L410 L610
  D228 CONC T144 IL18 I114 BN2P BN2T TRIS C408
`.trim().split(/\s+/));

export function followAircraftModel(type: string | null | undefined): AircraftModel {
  const code = type?.trim().toUpperCase() ?? '';
  return airlinerTypes.has(code) ? models.A320 : aircraftModel(code);
}

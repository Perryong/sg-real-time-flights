import {expect,it} from 'vitest';
import {aircraftModel} from './aircraftModels';
it.each([['A320','Airbus A320-200'],['A359','Airbus A350-900'],['A35K','Airbus A350-1000'],['B77L','Boeing 777-200LR'],['B77W','Boeing 777-300ER']])('uses the reported %s variant', (code,name)=>{
 const m=aircraftModel(code);expect(m.name).toBe(name);expect(m.specific).toBe(true);expect(m.file).not.toBe('generic-aircraft.glb');
});
it('normalizes type codes but does not guess a variant or airline',()=>{
 expect(aircraftModel(' a359 ')).toEqual(aircraftModel('A359'));
 for(const type of [null,'','B777','A20N','A319','A321','SIA'])expect(aircraftModel(type)).toMatchObject({specific:false,file:'generic-aircraft.glb'});
});

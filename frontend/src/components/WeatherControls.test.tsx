// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import WeatherControls from './WeatherControls';
import type {RegionalWindWeather} from '../data/weather';
afterEach(cleanup);
const now=1800000000;
const data:RegionalWindWeather={layer:'wind_regional',state:'fresh',observed_at:now-900,fetched_at:now,retry_after:900,message:null,kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:[{id:'grid-1',lat:3,lon:103,speed_mps:4,from_deg:30}]};
const props={preferences:{wind:true,radar:true,opacity:.6},onChange:vi.fn(),wind:{phase:'ready' as const,data},radar:{phase:'error' as const,message:'Weather request limit reached. Retrying later.'},unavailable:null,now,radarError:false};
it('distinguishes model valid time from station observations and labels real radar range',()=>{
 render(<WeatherControls {...props}/>);
 expect(screen.getByText('Regional surface wind · 10 m')).toBeTruthy();
 expect(screen.getByText(/Trails and arrowheads point downwind/)).toBeTruthy();
 expect(screen.getByText(/^Model valid .* SGT · 1 model point$/)).toBeTruthy();
 const scale=screen.getByRole('list',{name:'Wind speed in metres per second'});
 expect(scale.textContent).toBe('02510+');
 expect(screen.getByRole('button',{name:'Changi outlook'}).getAttribute('aria-expanded')).toBe('false');
 expect(screen.getByText('Rain radar · 480 km')).toBeTruthy();
 expect(screen.queryByText(/reporting stations/)).toBeNull();
 expect(screen.getByText(/Weather request limit reached/)).toBeTruthy();
});

it('disables Changi outlook along with weather outside an eligible view',()=>{
 render(<WeatherControls {...props} unavailable="Weather covers Singapore only."/>);
 expect(screen.getByRole('button',{name:'Changi outlook'}).hasAttribute('disabled')).toBe(true);
 expect(screen.getByText('Weather covers Singapore only.')).toBeTruthy();
});
it('does not present expired or missing model points as current wind',()=>{
 const view=render(<WeatherControls {...props} now={now+901}/>);
 expect(screen.getByText('Out of date. Overlay hidden.')).toBeTruthy();
 view.rerender(<WeatherControls {...props} wind={{phase:'ready',data:{...data,points:[]}}}/>);
 expect(screen.getByText('No regional wind estimates.')).toBeTruthy();
});

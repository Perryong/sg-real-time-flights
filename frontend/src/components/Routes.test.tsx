// @vitest-environment jsdom
import React from 'react';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import TrafficList from './TrafficList';
import AircraftDetails from './AircraftDetails';
import FollowPanel from './FollowPanel';
import {defaultFollowCamera} from '../data/follow';
import {track} from '../data/testHelpers';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const now=1795183200;
function inbound(){
 const t=track([now]);
 Object.assign(t.latest,{mode:'live',callsign:'SIA214',lat:2,lon:103.9915,track_deg:180,route:{provider:'flyitalyadsb',callsign:'SIA214',origin:'YPPH',destination:'WSSS',origin_iata:'PER',destination_iata:'SIN',observed_count:7,last_seen_day:'2026-11-19',retrieved_at:now}});
 return t;
}
const props={selected:null,onSelect:()=>{},now,query:'',setQuery:()=>{},filter:'all',setFilter:()=>{},onDemo:()=>{},unavailable:false};
it('filters likely Changi traffic and keeps demo independent',()=>{
 const t=inbound();const {rerender}=render(<TrafficList {...props} tracks={[t]} mode='live' />);
 expect(screen.getByText('Likely inbound')).toBeTruthy();
 expect(screen.getByText(/Usual route · PER → SIN/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Changi direction'),{target:{value:'outbound'}});
 expect(screen.queryByRole('button',{name:'Select SIA214'})).toBeNull();
 rerender(<TrafficList {...props} tracks={[t]} mode='simulated' />);
 expect(screen.getByRole('button',{name:'Select SIA214'})).toBeTruthy();
 expect(screen.queryByText('Likely inbound')).toBeNull();
});
it('explains historical evidence and links to official boards',()=>{
 render(<AircraftDetails track={inbound()} now={now} follow={false} onFollow={()=>{}} onClose={()=>{}} />);
 expect(screen.getByText(/Usual route · PER → SIN/)).toBeTruthy();
 expect(screen.getByText(/2026-11-19/)).toBeTruthy();
 expect(screen.getByText(/Today’s destination is unconfirmed/)).toBeTruthy();
 expect(screen.getByRole('link',{name:'Official Changi arrivals'}).getAttribute('href')).toBe('https://www.changiairport.com/en/fly/flight-information/arrivals.html');
 expect(screen.getByRole('link',{name:'Official Changi departures'})).toBeTruthy();
});
it('keeps foreign selected-aircraft details free of Changi inference and board links',()=>{
 render(<AircraftDetails track={inbound()} now={now} follow={false} isChangi={false} onFollow={()=>{}} onClose={()=>{}} />);
 expect(screen.queryByRole('link',{name:'Official Changi arrivals'})).toBeNull();
 expect(screen.queryByText('Likely inbound')).toBeNull();
 expect(screen.getByText(/Usual route · PER → SIN/)).toBeTruthy();
});
it('identifies the route in the follow view as usual and unconfirmed',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 const t=inbound(), noop=()=>{};
 render(<FollowPanel track={t} tracks={[t]} now={now} mode="live" camera={defaultFollowCamera} style="day" trails
  onCamera={noop} onStyle={noop} onTrails={noop} onSelect={noop} onExit={noop} />);
 expect(screen.getByText('Usual route · Destination unconfirmed')).toBeTruthy();
});

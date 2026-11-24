import {test,expect} from '@playwright/test';
import fs from 'node:fs';
test('Pages uses shared HTTP updates and keeps the selectable Cesium 3D view',async({page})=>{
  const fixture=JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8'));
  const frame=structuredClone(fixture.frames[0]);const now=Date.now()/1000;
  Object.assign(frame,{mode:'live',scenario_time:null,server_time:now});
  Object.assign(frame.status,{mode:'live',upstream_state:'healthy',collection_mode:'on_demand',movements:{day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now*1000)),airport:'WSSS',timezone:'Asia/Singapore',available:true,landings:3,takeoffs:2,first_observed_at:now-60,last_observed_at:now,observed_seconds:60,unmonitored_seconds:0},last_success:now});
  const track=frame.tracks[0];track.id='live:icao24:abc123';
  Object.assign(track.latest,{id:track.id,mode:'live',callsign:'CLOUD TEST',lat:1.36,lon:104,position_time:now,provider_time:now,receipt_time:now});
  track.history=[track.latest];frame.tracks=[track];
  const sockets:string[]=[];page.on('websocket',s=>sockets.push(s.url()));
  await page.route('https://sg-changi-feed-test.vercel.app/api/aircraft',route=>route.fulfill({json:frame,
    headers:{'access-control-allow-origin':'*','x-response-time':String(now),'access-control-expose-headers':'X-Response-Time'}}));
  await page.goto('./');
  await expect(page.getByRole('button',{name:'Select CLOUD TEST'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Changi daily movements'})).toHaveCount(0);
  await expect(page.getByText(/Counts are saved in the cloud/)).toHaveCount(0);
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect(page.getByRole('button',{name:'2D',exact:true})).toBeVisible();
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();
  await page.getByRole('button',{name:'Select CLOUD TEST'}).click();
  await expect(page.getByRole('region',{name:'Selected aircraft details'})).toBeVisible();
  expect(sockets).toEqual([]);
});

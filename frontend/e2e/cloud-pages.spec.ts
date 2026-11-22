import {test,expect} from '@playwright/test';
import fs from 'node:fs';
test('Pages uses shared HTTP updates and keeps the selectable Cesium 3D view',async({page})=>{
  const fixture=JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8'));
  const frame=structuredClone(fixture.frames[0]);const now=Date.now()/1000;
  Object.assign(frame,{mode:'live',scenario_time:null,server_time:now});
  Object.assign(frame.status,{mode:'live',upstream_state:'healthy',collection_mode:'on_demand',movements:null,last_success:now});
  const track=frame.tracks[0];track.id='live:icao24:abc123';
  Object.assign(track.latest,{id:track.id,mode:'live',callsign:'CLOUD TEST',lat:1.36,lon:104,position_time:now,provider_time:now,receipt_time:now});
  track.history=[track.latest];frame.tracks=[track];
  const sockets:string[]=[];page.on('websocket',s=>sockets.push(s.url()));
  await page.route('https://sg-changi-feed-test.vercel.app/api/aircraft',route=>route.fulfill({json:frame,
    headers:{'access-control-allow-origin':'*','x-response-time':String(now),'access-control-expose-headers':'X-Response-Time'}}));
  await page.goto('./');
  await expect(page.getByRole('button',{name:'Select CLOUD TEST'})).toBeVisible();
  await expect(page.getByText('LIVE WHILE VIEWING')).toBeVisible();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect(page.getByRole('button',{name:'2D',exact:true})).toBeVisible();
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();
  await page.getByRole('button',{name:'Select CLOUD TEST'}).click();
  await expect(page.getByRole('region',{name:'Selected aircraft details'})).toBeVisible();
  expect(sockets).toEqual([]);
});

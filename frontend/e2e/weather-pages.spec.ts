import {test,expect} from '@playwright/test';
import fs from 'node:fs';
for(const mobile of [false,true])test(`weather overlays and aircraft follow ${mobile?'mobile':'desktop'}`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{window.__changiBenchmark={frames:[],ready:false,failed:false,lastRender:0,aircraftCount:0,visibleCount:0}});
 await page.emulateMedia({reducedMotion:mobile?'reduce':'no-preference'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8'));
 await page.route('**/api/aircraft*',route=>{
  const now=Date.now()/1000,frame=structuredClone(fixture.frames[0]);
  Object.assign(frame,{mode:'live',scenario_time:null,server_time:now});
  Object.assign(frame.status,{mode:'live',upstream_state:'healthy',movements:null,last_success:now});
  const t=frame.tracks[0];t.id='live:icao24:abc123';
  Object.assign(t.latest,{id:t.id,mode:'live',callsign:'WEATHER TEST',lat:1.36,lon:103.95,ground:false,alt_geom_m:1000,position_time:now,provider_time:now,receipt_time:now});
  t.history=[t.latest];frame.tracks=[t];return route.fulfill({json:frame});
 });
 const requests:string[]=[];
 await page.route('**/api/weather?*',route=>{
  const layer=new URL(route.request().url()).searchParams.get('layer');requests.push(layer!);
  const now=Date.now()/1000;
  return route.fulfill({json:{layer,state:'fresh',observed_at:now,fetched_at:now,retry_after:60,message:null,...(layer==='wind_regional'?{kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:[{id:'grid-1',lat:3,lon:103,speed_mps:4,from_deg:45},{id:'grid-2',lat:1.36,lon:103.98,speed_mps:1,from_deg:180}]}:{range_km:480,radar:{url:'https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/test.png',west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:now,expires_at:now+3600}})}});
 });
 await page.route('https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/test.png',r=>r.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNg+M/gAMYwBgAtbAT9Ji/7WAAAAABJRU5ErkJggg==','base64')}));
 await page.goto('./');
 await expect(page.locator('.cesium-widget canvas')).toBeVisible();
 const wind=page.getByRole('button',{name:'Wind',exact:true}),radar=page.getByRole('button',{name:'Rain radar',exact:true});
 await expect(wind).toHaveAttribute('aria-pressed','false');await expect(radar).toHaveAttribute('aria-pressed','false');expect(requests).toEqual([]);
 await wind.click();await expect(page.getByText(/2 model points/)).toBeVisible();expect(requests).toEqual(['wind_regional']);
 await radar.click();await expect(page.getByLabel('Radar opacity')).toBeVisible();
 await expect(page.getByText('Rain radar · 480 km')).toBeVisible();
 await expect(page.getByText('Regional wind · 500 km')).toBeVisible();
 await expect(page.getByText(/Modelled surface wind · 10 m height/)).toBeVisible();
 expect(requests).toEqual(['wind_regional','radar_wide']);
 await page.getByLabel('Radar opacity').fill('40');await page.getByLabel('Radar opacity').press('ArrowRight');
 await expect(page.locator('.weather-opacity output')).toHaveText('45%');
 // Allow Cesium geometry and imagery to reach the render loop before checking errors.
 await page.waitForTimeout(2000);
 await expect(page.getByText(/Radar image unavailable/)).toHaveCount(0);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await page.screenshot({path:`/tmp/changi-weather-${mobile?'mobile':'desktop'}.png`});
 if(mobile)await page.getByRole('button',{name:'Toggle aircraft list'}).click();
 await page.getByRole('button',{name:'Select WEATHER TEST',exact:true}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 await expect(page.getByRole('region',{name:'3D aircraft follow'})).toBeVisible();
 await expect(wind).toBeVisible();await expect(radar).toBeVisible();
 await wind.click();await expect(wind).toHaveAttribute('aria-pressed','false');await expect(radar).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Exit aircraft follow'}).click();
 if(mobile){
  await page.route('**/api/location/postal',route=>route.fulfill({json:{results:[{lat:1.3644,lon:103.9915,label:'Weather pin test',postal:'819643'}]}}));
  await page.getByRole('button',{name:'My location',exact:true}).click();
  await page.getByLabel('Singapore postal code').fill('819643');
  await page.getByRole('button',{name:'Find',exact:true}).click({timeout:3000});
  await expect(page.getByText('Weather pin test')).toBeVisible();
  await page.getByRole('button',{name:'Sky view from pin'}).click();
  await expect(page.getByLabel('Sky direction')).toBeVisible();
  await page.getByRole('button',{name:'Return to map'}).click();
  await page.getByRole('button',{name:'Remove pin'}).click();
 }
 await page.getByLabel(mobile?'Map region':'Airspace region',{exact:true}).selectOption('london');
 await expect(radar).toBeDisabled();await expect(page.getByText('Weather covers Singapore only.')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
 expect(await page.evaluate(()=>({failed:window.__changiBenchmark?.failed,frames:window.__changiBenchmark?.frames.length}))).toMatchObject({failed:false,frames:expect.any(Number)});
 await expect(page.getByText(/3D rendering interrupted|WebGL context lost/)).toHaveCount(0);
});

test('hides stale regional estimates and expired wide radar images',async({page})=>{
 let imageRequests=0;
 await page.route('**/api/aircraft*',route=>route.fulfill({status:503,json:{error:'Feed unavailable'}}));
 await page.route('**/api/weather?*',route=>{
  const now=Date.now()/1000,layer=new URL(route.request().url()).searchParams.get('layer');
  return route.fulfill({json:{layer,state:'fresh',observed_at:now-(layer==='wind_regional'?1801:300),fetched_at:now,retry_after:900,message:null,...(layer==='wind_regional'?{kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:[{id:'grid-1',lat:3,lon:103,speed_mps:4,from_deg:45}]}:{range_km:480,radar:{url:'https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/expired.png',west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:now-300,expires_at:now-1}})}});
 });
 await page.route('**/expired.png',route=>{imageRequests++;return route.abort()});
 await page.goto('./');await expect(page.locator('.cesium-widget canvas')).toBeVisible();
 await page.getByRole('button',{name:'Wind',exact:true}).click();await page.getByRole('button',{name:'Rain radar',exact:true}).click();
 await expect(page.getByText('Out of date. Overlay hidden.',{exact:true})).toHaveCount(2);
 expect(imageRequests).toBe(0);
});

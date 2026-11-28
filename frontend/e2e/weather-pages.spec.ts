import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {visibleMarkers} from './visibleMarkers';
function regionalGrid() {
  const points = [];
  for (let north = -4; north <= 4; north++) {
    for (let east = -4; east <= 4; east++) {
      if (north * north + east * east > 16) continue;
      points.push({
        id: `regional:${north}:${east}`, lat: 1.3644 + north * 1.1, lon: 103.9915 + east * 1.1,
        speed_mps: 7, from_deg: 45,
      });
    }
  }
  return points;
}

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
  if(layer==='radar_history'){
   const end=Math.floor(now/300)*300;
   const frames=[0,6,12].map(i=>({url:`https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/history-${i}.png`,west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:end-3600+i*300,expires_at:now+3600}));
   return route.fulfill({json:{layer,state:'fresh',observed_at:end,fetched_at:now,retry_after:300,message:null,range_km:480,window_start:end-3600,window_end:end,expected_frames:13,frames}});
  }
  return route.fulfill({json:{layer,state:'fresh',observed_at:now,fetched_at:now,retry_after:60,message:null,...(layer==='wind_regional'?{kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:regionalGrid()}:{range_km:480,radar:{url:'https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/test.png',west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:now,expires_at:now+3600}})}});
 });
 await page.route('https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/*.png',r=>r.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNg+M/gAMYwBgAtbAT9Ji/7WAAAAABJRU5ErkJggg==','base64')}));
 await page.goto('./');
 await expect(page.locator('.cesium-widget canvas')).toBeVisible();
 const wind=page.getByRole('button',{name:'Wind',exact:true}),radar=page.getByRole('button',{name:'Rain radar',exact:true});
 await expect(wind).toHaveAttribute('aria-pressed','false');await expect(radar).toHaveAttribute('aria-pressed','false');expect(requests).toEqual([]);
 await wind.click();await expect(page.getByText(/49 model points/)).toBeVisible();expect(requests).toEqual(['wind_regional']);
 await radar.click();await expect(page.getByLabel('Radar opacity')).toBeVisible();
 await expect(page.getByText('Rain radar · 480 km')).toBeVisible();
 await expect(page.getByText('Regional surface wind · 10 m')).toBeVisible();
 await expect(page.getByRole('list',{name:'Wind speed in metres per second'}).getByRole('listitem')).toHaveText(['0','2','5','10+']);
 expect(requests).toEqual(['wind_regional','radar_wide']);
 await page.getByLabel('Radar opacity').fill('40');await page.getByLabel('Radar opacity').press('ArrowRight');
 await expect(page.locator('.weather-opacity output')).toHaveText('45%');
 // Allow Cesium geometry and imagery to reach the render loop before checking errors.
 await page.waitForTimeout(2000);
 await expect(page.getByText(/Radar image unavailable/)).toHaveCount(0);
 await page.getByRole('button',{name:'Past hour',exact:true}).click();
 const replay=page.getByRole('region',{name:'Rain radar playback'});
 await expect(replay).toBeVisible();await expect(replay.getByText('Aircraft remain live')).toBeVisible();
 await expect(replay.getByText('3/13 frames available · missing frames omitted')).toBeVisible();
 expect(requests.filter(x=>x==='radar_history')).toHaveLength(1);
 await expect(page.getByRole('button',{name:'Play radar',exact:true})).toBeEnabled();
 const slider=page.getByRole('slider',{name:'Rain radar time'});
 await expect(slider).toHaveValue('0');
 await page.getByRole('button',{name:'Play radar',exact:true}).click();
 await expect(slider).toHaveValue('1',{timeout:10000});
 await page.getByRole('button',{name:'Pause radar',exact:true}).click();
 await slider.fill('2');await slider.press('ArrowLeft');await expect(slider).toHaveValue('1');
 await expect(page.getByRole('button',{name:'Play radar',exact:true})).toBeEnabled();
 expect(requests.filter(x=>x==='radar_history')).toHaveLength(1);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await page.screenshot({path:`/tmp/changi-weather-${mobile?'mobile':'desktop'}.png`});
 if(mobile)await page.getByRole('button',{name:'Toggle aircraft list'}).click();
 await expect(replay.getByText(/Wind model valid .*SGT/)).toBeVisible();
 await page.getByRole('button',{name:'Select WEATHER TEST',exact:true}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 await expect(page.getByRole('region',{name:'3D aircraft follow'})).toBeVisible();
 await expect(wind).toBeVisible();await expect(radar).toBeVisible();
 await expect(replay).toBeVisible();
 await page.screenshot({path:`/tmp/changi-radar-follow-${mobile?'mobile':'desktop'}.png`});
 await replay.getByRole('button',{name:'Return to Live',exact:true}).click();
 await expect(replay).toHaveCount(0);
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

for (const mobile of [false, true]) {
  test(`fixed Changi outlook across Singapore midnight on ${mobile ? 'mobile' : 'desktop'}`, async ({page}, testInfo) => {
    if (mobile) await page.setViewportSize({width: 390, height: 844});
    const beforeMidnight = new Date('2026-11-30T15:52:00Z');
    const at = beforeMidnight.getTime() / 1000;
    await page.clock.install({time: beforeMidnight});
    const snapshot = JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8')).frames[0];
    Object.assign(snapshot, {mode:'live', scenario_time:null, server_time:at});
    Object.assign(snapshot.status, {mode:'live', upstream_state:'healthy', last_success:at, movements:null});
    snapshot.tracks = snapshot.tracks.slice(0, 2);
    for (const track of snapshot.tracks) {
      Object.assign(track.latest, {mode:'live', position_time:at, provider_time:at, receipt_time:at});
      track.history = [track.latest];
    }
    await page.route('**/api/aircraft*', route => route.fulfill({json:snapshot}));
    const requests: string[] = [];
    await page.route('**/api/weather?*', route => {
      const layer = new URL(route.request().url()).searchParams.get('layer')!;
      requests.push(layer);
      return route.fulfill({json:{
        layer, state:'fresh', source:'Open-Meteo', location:{name:'Changi Airport',lat:1.3644,lon:103.9915},
        observed_at:at, fetched_at:at, retry_after:900, message:null, current:{humidity_pct:0,pressure_msl_hpa:null},
        daily:[1,2,4,5].map(day => ({date:`2026-12-0${day}`,weather_code:day === 1 ? 0 : 3,low_c:23,high_c:31})),
      }});
    });
    await page.goto('./');
    const open = page.getByRole('button', {name:'Changi outlook', exact:true});
    await expect(open).toBeEnabled();
    expect(requests).toEqual([]);
    await open.click();
    const card = page.getByRole('dialog', {name:'Changi Airport, Singapore'});
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Open-Meteo/);
    await expect(card).toContainText(/0\s*%/);
    const days = card.getByRole('list', {name:'Next five days'}).getByRole('listitem');
    await expect(days).toHaveCount(5);
    const dates = () => days.locator('time').evaluateAll(rows => rows.map(row => row.getAttribute('datetime')));
    const expected = ['2026-12-01','2026-12-02','2026-12-03','2026-12-04','2026-12-05'];
    await expect.poll(dates).toEqual(expected);
    await expect(days.first()).toContainText(/clear sky/i);
    await expect(days.nth(2)).toContainText(/Unavailable/i);
    await expect(days.nth(3)).toContainText(/31/);
    if (!mobile) {
      for (const track of snapshot.tracks) {
        await page.getByRole('button', {name:`Select ${track.latest.callsign}`, exact:true}).click();
        await expect(page.getByRole('region', {name:'Selected aircraft details'})).toContainText(track.latest.callsign);
        await expect(card).toBeVisible();
        await expect.poll(async () => (await visibleMarkers(page)).lime.length).toBeGreaterThan(5);
      }
      await expect.poll(dates).toEqual(expected);
      expect(requests).toEqual(['changi_outlook']);
    }
    const close = card.getByRole('button', {name:'Close Changi outlook'});
    await page.screenshot({path:testInfo.outputPath('changi-outlook.png')});
    await page.clock.fastForward(9 * 60000);
    await expect.poll(dates).toEqual([...expected.slice(1), '2026-12-06']);
    await expect(days.last()).toContainText(/Unavailable/i);
    await close.click();
    await expect(open).toBeFocused();
    await page.clock.fastForward(16 * 60000);
    expect(requests).toEqual(['changi_outlook']);
    await page.getByRole('button', {name:'Demo', exact:true}).click();
    await expect(open).toBeDisabled();
    expect(requests).toEqual(['changi_outlook']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('compact desktop keeps aircraft selectable with wind and outlook open', async ({page}) => {
  await page.setViewportSize({width:801, height:900});
  const frame = JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json', 'utf8')).frames[0];
  const now = Date.now() / 1000;
  Object.assign(frame, {mode:'live', scenario_time:null, server_time:now});
  Object.assign(frame.status, {mode:'live', upstream_state:'healthy', last_success:now, movements:null});
  for (const track of frame.tracks) {
    Object.assign(track.latest, {mode:'live', position_time:now, provider_time:now, receipt_time:now});
    track.history = [track.latest];
  }
  await page.route('**/api/aircraft*', route => route.fulfill({json:frame}));
  const singaporeDay = Math.floor((now + 8 * 3600) / 86400);
  await page.route('**/api/weather?*', route => {
    const layer = new URL(route.request().url()).searchParams.get('layer');
    const data = layer === 'wind_regional'
      ? {kind:'model', height_m:10, coverage_km:500, points:regionalGrid()}
      : {location:{name:'Changi Airport',lat:1.3644,lon:103.9915}, current:{humidity_pct:80,pressure_msl_hpa:1010},
        daily:[1,2,3,4,5].map(offset => ({
          date:new Date((singaporeDay + offset) * 86400000).toISOString().slice(0,10),
          weather_code:3, low_c:24, high_c:31,
        }))};
    return route.fulfill({json:{layer, state:'fresh', source:'Open-Meteo', observed_at:now,
      fetched_at:now, retry_after:900, message:null, ...data}});
  });
  await page.goto('./');
  await page.getByRole('button', {name:'Wind', exact:true}).click();
  await page.getByRole('button', {name:'Changi outlook', exact:true}).click();
  const outlook = page.getByRole('dialog', {name:'Changi Airport, Singapore'});
  for (const track of frame.tracks.slice(0, 2)) {
    const callsign = track.latest.callsign;
    await page.getByRole('button', {name:'Select ' + callsign, exact:true}).click({timeout:5000});
    await expect(page.getByRole('region', {name:'Selected aircraft details'})).toContainText(callsign);
    await expect(outlook).toBeVisible();
  }
  const lastDay = outlook.getByRole('listitem').last();
  await expect(lastDay).toContainText('Overcast');
  await expect(lastDay).not.toBeInViewport();
  await outlook.getByRole('heading', {name:'Changi Airport, Singapore'}).hover();
  await page.mouse.wheel(0, 650);
  await expect(lastDay).toBeInViewport({ratio:0.9, timeout:3000});
});

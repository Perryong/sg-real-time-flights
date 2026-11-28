import {test,expect,type Locator,type Page} from '@playwright/test';
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

async function useLiveWeather(page: Page, withGroundTraffic = false) {
 const fixture=JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8'));
 await page.route('**/api/aircraft*',route=>{
  const now=Date.now()/1000,frame=structuredClone(fixture.frames[0]);
  Object.assign(frame,{mode:'live',scenario_time:null,server_time:now});
  Object.assign(frame.status,{mode:'live',upstream_state:'healthy',movements:null,last_success:now});
  const t=frame.tracks[0];t.id='live:icao24:abc123';
  Object.assign(t.latest,{id:t.id,mode:'live',callsign:'WEATHER TEST',lat:1.36,lon:103.95,ground:false,alt_geom_m:1000,position_time:now,provider_time:now,receipt_time:now});
  t.history=[t.latest];frame.tracks=[t];
  if (withGroundTraffic) {
   const ground = structuredClone(t);
   ground.id = 'live:icao24:abc124';
   Object.assign(ground.latest, {id:ground.id, callsign:'WEATHER GROUND', ground:true, lat:1.3644, lon:103.9915});
   ground.history = [ground.latest];
   frame.tracks.push(ground);
  }
  return route.fulfill({json:frame});
 });
 const requests:string[]=[];
 await page.route('**/api/weather?*',route=>{
  const layer=new URL(route.request().url()).searchParams.get('layer');requests.push(layer!);
  const now=Date.now()/1000;
  if (layer === 'changi_outlook') {
   const singaporeDay = Math.floor((now + 8 * 3600) / 86400);
   return route.fulfill({json:{
    layer, state:'fresh', observed_at:now, fetched_at:now, retry_after:300, message:null, source:'Open-Meteo',
    location:{name:'Changi Airport',lat:1.3644,lon:103.9915}, current:{humidity_pct:80,pressure_msl_hpa:1010},
    daily:[1,2,3,4,5].map(offset => ({
     date:new Date((singaporeDay + offset) * 86400000).toISOString().slice(0,10),
     weather_code:3, low_c:24, high_c:31,
    })),
   }});
  }
  if(layer==='radar_history'){
   const end=Math.floor(now/300)*300;
   const frames=[0,6,12].map(i=>({url:`https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/history-${i}.png`,west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:end-3600+i*300,expires_at:now+3600}));
   return route.fulfill({json:{layer,state:'fresh',observed_at:end,fetched_at:now,retry_after:300,message:null,range_km:480,window_start:end-3600,window_end:end,expected_frames:13,frames}});
  }
  return route.fulfill({json:{layer,state:'fresh',observed_at:now,fetched_at:now,retry_after:60,message:null,...(layer==='wind_regional'?{kind:'model',source:'Open-Meteo',height_m:10,coverage_km:500,points:regionalGrid()}:{range_km:480,radar:{url:'https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/test.png',west:99.638609,south:-2.967382,east:108.290871,north:5.657912,observed_at:now,expires_at:now+3600}})}});
 });
 await page.route('https://dgs-backend-app-assets-production.s3.ap-southeast-1.amazonaws.com/*.png',r=>r.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNg+M/gAMYwBgAtbAT9Ji/7WAAAAABJRU5ErkJggg==','base64')}));
 return requests;
}

async function expectOnScreen(control: Locator, viewport: {width: number; height: number}) {
 const box = await control.boundingBox();
 expect(box).not.toBeNull();
 expect(box!.x).toBeGreaterThanOrEqual(0);
 expect(box!.y).toBeGreaterThanOrEqual(0);
 expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
 expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
 expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
 return box!;
}

async function highlightedMarker(page: Page) {
 const {lime} = await visibleMarkers(page);
 if (lime.length <= 8) return null;
 return {
  x:lime.reduce((sum, point) => sum + point.x, 0) / lime.length,
  y:lime.reduce((sum, point) => sum + point.y, 0) / lime.length,
 };
}

test.describe('responsive map panels', () => {
 test.use({viewport:{width:320,height:568}, hasTouch:true, reducedMotion:'reduce'});

 test('closing the outlook preserves the next keyboard focus', async ({page}) => {
  await useLiveWeather(page);
  await page.goto('./');
  const outlook = page.getByRole('button', {name:'Changi outlook',exact:true});
  await outlook.click();
  const close = page.getByRole('button', {name:'Close Changi outlook'});
  const collapse = page.getByRole('button', {name:'Collapse panels'});
  await close.evaluate(async el => {
   el.click();
   await Promise.resolve();
   document.querySelector<HTMLButtonElement>('[aria-label="Collapse panels"]')!.focus();
   await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(collapse).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', {name:'Weather layers'})).toBeHidden();
 });

 test('keeps traffic and weather usable across the same live session', async ({page}, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
   window.__changiBenchmark = {frames:[], ready:false, failed:false, lastRender:0, aircraftCount:0, visibleCount:0};
  });
  const requests = await useLiveWeather(page, true);
  await page.goto('./');
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();

  const controls = page.getByRole('group', {name:'Map panels'});
  const trafficButton = controls.getByRole('button', {name:'Traffic',exact:true});
  const weatherButton = controls.getByRole('button', {name:'Weather',exact:true});
  const collapse = controls.getByRole('button', {name:'Collapse panels',exact:true});
  const traffic = page.getByRole('region', {name:'Aircraft list'});
  const weather = page.getByRole('region', {name:'Weather layers'});
  const search = traffic.getByRole('textbox', {name:'Search aircraft'});
  const filters = traffic.getByText('Flight filters', {exact:true});
  const row = traffic.getByRole('button', {name:'Select WEATHER TEST',exact:true});
  const ground = traffic.getByRole('button', {name:'Select WEATHER GROUND',exact:true});
  const wind = weather.getByRole('button', {name:'Wind',exact:true});
  const radar = weather.getByRole('button', {name:'Rain radar',exact:true});
  const opacity = weather.getByRole('slider', {name:'Radar opacity'});
  const outlookButton = weather.getByRole('button', {name:'Changi outlook',exact:true});
  const details = page.getByRole('region', {name:'Selected aircraft details'});
  const replay = page.getByRole('region', {name:'Rain radar playback'});

  if (!(await traffic.isVisible())) await trafficButton.tap();
  await expect(row).toBeInViewport();
  expect(await row.evaluate(element => {
   const box = element.getBoundingClientRect();
   return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  for (const control of [trafficButton, weatherButton, collapse]) {
   const box = await expectOnScreen(control, {width:320,height:568});
   expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
  await expect(ground).toBeVisible();
  await filters.tap();
  await traffic.getByRole('button', {name:'Airborne',exact:true}).tap();
  await expect(ground).toHaveCount(0);
  const direction = traffic.getByLabel('Changi direction');
  await direction.selectOption('unknown');
  await search.fill('WEATHER');
  await filters.tap();
  await row.tap();
  await expect(traffic).toBeHidden();
  await expect(trafficButton).toBeFocused();
  await expect(details.getByRole('heading', {name:'WEATHER TEST'})).toBeVisible();
  await expect.poll(() => highlightedMarker(page)).not.toBeNull();

  await weatherButton.press('Space');
  await expect(weather).toBeVisible();
  await wind.tap();
  await radar.tap();
  await expect(weather.getByText(/Model valid .* SGT/)).toBeVisible();
  await expect(weather.getByRole('list', {name:'Wind speed in metres per second'}).getByRole('listitem'))
   .toHaveText(['0','2','5','10+']);
  await expect(weather.getByText('Rain radar · 480 km')).toBeVisible();
  await expect(weather.getByText('Light', {exact:true})).toBeVisible();
  await expect(weather.getByText('Heavy', {exact:true})).toBeVisible();
  await opacity.fill('55');
  await opacity.press('ArrowRight');
  await expect(opacity).toHaveValue('60');
  await weather.getByRole('button', {name:'Past hour',exact:true}).click();
  await expect(replay.getByText('Aircraft remain live')).toBeVisible();
  const replayTime = replay.getByRole('slider', {name:'Rain radar time'});
  await expect(replayTime).toHaveValue('0');
  await replay.getByRole('button', {name:'Play radar',exact:true}).click();
  await expect(replayTime).toHaveValue('1');
  await replay.getByRole('button', {name:'Pause radar',exact:true}).click();
  await expect(replay.getByText('3/13 frames available · missing frames omitted')).toBeVisible();
  const smallest = testInfo.outputPath('320x568-weather.png');
  await page.screenshot({path:smallest});
  await testInfo.attach('320x568 weather', {path:smallest,contentType:'image/png'});

  for (const [width, height, compact, returning] of [
   [390,844,true], [768,1024,true], [820,1180,true], [768,1024,true,true],
   [1024,768,false], [1440,900,false], [844,390,true],
  ] as const) {
   const viewport = {width,height};
   await page.setViewportSize(viewport);
   await expect(weather).toBeVisible();
   if (compact) await expect(traffic).toBeHidden();
   else await expect(traffic).toBeVisible();
   await expectOnScreen(weather, viewport);
   await expect(wind).toHaveAttribute('aria-pressed','true');
   await expect(radar).toHaveAttribute('aria-pressed','true');
   await expect(opacity).toHaveValue('60');
   await expect(replayTime).toHaveValue('1');
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
   if (compact) await collapse.tap();
   await expect(details.getByRole('heading', {name:'WEATHER TEST'})).toBeVisible();
   if (compact) await trafficButton.tap();
   await expectOnScreen(traffic, viewport);
   await expect(search).toHaveValue('WEATHER');
   await expect(row).toHaveClass(/\bselected\b/);
   await expect(ground).toHaveCount(0);
   if (!(await direction.isVisible())) {
    await filters.click();
    await expect(direction).toHaveValue('unknown');
    await filters.click();
   } else {
    await expect(direction).toHaveValue('unknown');
   }
   if (compact) await weatherButton.tap();
   if (!returning) {
    const screenshot = testInfo.outputPath(`${width}x${height}-weather.png`);
    await page.screenshot({path:screenshot});
    await testInfo.attach(`${width}x${height} weather`, {path:screenshot,contentType:'image/png'});
   }
  }

  const credit = weather.getByRole('link', {name:'MSS / NEA via data.gov.sg'});
  await credit.scrollIntoViewIfNeeded();
  await expect(credit).toBeInViewport({ratio:1});
  await opacity.scrollIntoViewIfNeeded();
  await expect(opacity).toBeInViewport({ratio:1});
  await opacity.press('ArrowLeft');
  await expect(opacity).toHaveValue('55');
  await replay.getByRole('button', {name:'Return to Live',exact:true}).click();
  await expect(replay).toHaveCount(0);
  await expect(weather.getByRole('button', {name:'Past hour',exact:true})).toBeEnabled();
  expect(requests.filter(layer => layer === 'radar_history')).toHaveLength(1);
  await outlookButton.tap();
  const outlook = page.getByRole('dialog', {name:'Changi Airport, Singapore'});
  await expect(outlook.getByRole('list', {name:'Next five days'}).getByRole('listitem')).toHaveCount(5);
  await outlook.getByRole('button', {name:'Close Changi outlook'}).tap();
  await expect(outlook).toBeHidden();
  await expect(outlookButton).toBeFocused();

  await page.setViewportSize({width:390,height:844});
  await collapse.press('Space');
  await expect(weather).toBeHidden();
  await expect(weatherButton).toBeFocused();
  expect(await weatherButton.evaluate(el => {
   const style = getComputedStyle(el);
   return el.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
  await trafficButton.tap();
  await row.tap();
  await expect.poll(() => highlightedMarker(page)).not.toBeNull();
  const beforePan = (await highlightedMarker(page))!;
  const start = await page.evaluate(({x,y}) => {
   const canvas = document.querySelector('.cesium-widget canvas');
   for (const offset of [30,-30,60,-60]) {
    const start = x < innerWidth / 2 ? x - 20 : x - 70;
    if ([start,start + 25,start + 50].every(point => document.elementFromPoint(point,y + offset) === canvas)) {
     return {x:start, y:y + offset};
    }
   }
   return null;
  }, beforePan);
  expect(start).not.toBeNull();
  await page.mouse.move(start!.x,start!.y);
  await page.mouse.down();
  await page.mouse.move(start!.x + 50,start!.y, {steps:8});
  await page.mouse.up();
  await expect.poll(async () => {
   const marker = await highlightedMarker(page);
   return marker ? marker.x - beforePan.x : 0;
  }).toBeGreaterThan(15);
  const cameraHeight = () => page.evaluate(() => window.__changiBenchmark?.cameraHeight ?? NaN);
  await expect.poll(cameraHeight).toBeGreaterThan(0);
  const beforeZoom = await cameraHeight();
  await page.mouse.move(start!.x,start!.y);
  await page.mouse.wheel(0,-250);
  await expect.poll(cameraHeight).toBeLessThan(beforeZoom * 0.99);
 });
});

for(const mobile of [false,true])test(`weather overlays and aircraft follow ${mobile?'mobile':'desktop'}`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{window.__changiBenchmark={frames:[],ready:false,failed:false,lastRender:0,aircraftCount:0,visibleCount:0}});
 await page.emulateMedia({reducedMotion:mobile?'reduce':'no-preference'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const requests=await useLiveWeather(page);
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
 await expect(replay.getByText(/Wind model valid .*SGT/)).toBeVisible();
 const panelControls=page.getByRole('group',{name:'Map panels'});
 if(mobile)await panelControls.getByRole('button',{name:'Traffic',exact:true}).click();
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
 if(mobile)await panelControls.getByRole('button',{name:'Weather',exact:true}).click();
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
        await expect.poll(async () => (await visibleMarkers(page)).lime.length, {
          message: `Map shows the selected aircraft ${track.latest.callsign} beside the open outlook`,
          timeout: 15000,
        }).toBeGreaterThan(5);
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

test('wide map keeps aircraft selectable with wind and outlook open', async ({page}) => {
  await page.setViewportSize({width:1024, height:560});
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

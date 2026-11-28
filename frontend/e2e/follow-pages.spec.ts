import {test,expect,type Page} from '@playwright/test';
import type {Snapshot} from '../src/data/types';
for(const mobile of [false,true])test(`immersive follow works ${mobile?'on mobile':'on desktop'} without a pin`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('./');await page.getByRole('button',{name:'Demo',exact:true}).click();
 if(mobile)await page.getByRole('button',{name:'Toggle aircraft list'}).click();
 await page.getByRole('button',{name:'Select SYN 101',exact:true}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 const panel=page.getByRole('region',{name:'3D aircraft follow'});await expect(panel).toBeVisible();
 await expect(page.getByRole('region',{name:'Selected aircraft details'})).toHaveCount(0);
 await expect(panel.getByText('SIMULATED / RECORDED · NOT LIVE')).toBeVisible();
 await panel.getByText('View controls',{exact:true}).click();
 await page.getByLabel('Follow orbit',{exact:true}).fill('120');
 await page.getByLabel('Follow distance',{exact:true}).fill('400');
 await panel.getByRole('button',{name:'Reset behind aircraft'}).click();
 await expect(page.getByLabel('Follow orbit',{exact:true})).toHaveValue('0');
 await expect(page.getByLabel('Follow distance',{exact:true})).toHaveValue('180');
 await page.getByLabel('Follow map style').selectOption('day');
 await panel.getByText('View controls',{exact:true}).click();
 await page.screenshot({path:`/tmp/changi-follow-${mobile?'mobile':'desktop'}.jpg`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Exit aircraft follow'}).click();
 await expect(panel).toHaveCount(0);await expect(page.getByRole('button',{name:'Follow aircraft',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});

test('regional follow falls back from satellite, pauses stale data and exits when lost',async({page})=>{
 await page.setViewportSize({width:1024,height:900});
 const fs=await import('node:fs');
 const fixture=JSON.parse(fs.readFileSync('../tests/fixtures/scenarios/changi-demo.json','utf8'));
 const now=Date.now()/1000;
 await page.clock.install({time:new Date(now*1000)});
 const requests:string[]=[];
 await page.route('https://sg-changi-feed-test.vercel.app/api/aircraft*',route=>{
  const foreign=new URL(route.request().url()).searchParams.get('region')==='london';
  requests.push(foreign?'london':'singapore');
  const frame=structuredClone(fixture.frames[0]);
  Object.assign(frame,{mode:'live',scenario_time:null,server_time:now,epoch:foreign?'london':'singapore'});
  Object.assign(frame.status,{mode:'live',upstream_state:'healthy',collection_mode:'on_demand',movements:null,last_success:now});
  const t=frame.tracks[0];t.id='live:icao24:abc123';
  Object.assign(t.latest,{id:t.id,mode:'live',callsign:foreign?'LONDON TEST':'SG TEST',lat:foreign?51.5:1.36,lon:foreign?-0.4:104,ground:false,alt_geom_m:12500,position_time:now,provider_time:now,receipt_time:now});
  t.history=[t.latest];frame.tracks=[t];
  return route.fulfill({json:frame,headers:{'access-control-allow-origin':'*'}});
 });
 await page.route('https://tiles.maps.eox.at/**',r=>r.abort());
 await page.goto('./');
 await expect(page.getByRole('button',{name:'Select SG TEST'})).toBeVisible();
 await page.getByLabel('Map region',{exact:true}).selectOption('london');
 await expect(page.getByRole('button',{name:'Select LONDON TEST'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Select SG TEST'})).toHaveCount(0);
 await expect(page.getByLabel('Detected landings')).toHaveCount(0);
 await page.getByRole('button',{name:'Select LONDON TEST'}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 const panel=page.getByRole('region',{name:'3D aircraft follow'});
 await expect(panel).toBeVisible();
 await expect(page.getByText('Satellite imagery unavailable; showing the day map.')).toBeVisible();
 await page.clock.fastForward(21000);
 await expect(panel.getByText(/View paused/)).toBeVisible();
 await page.clock.fastForward(101000);
 await expect(panel).toHaveCount(0);
 expect(requests).toContain('london');
});

test('shows distinct A350 and 777 models with an explicit fallback for other types',async({page})=>{
 const loaded=new Set<string>();page.on('response',r=>{if(r.ok()&&r.url().endsWith('.glb'))loaded.add(r.url().split('/').at(-1)!)});
 await page.goto('./');await page.getByRole('button',{name:'Demo',exact:true}).click();
 await page.getByRole('button',{name:'Pause playback'}).click();
 await page.getByRole('button',{name:'Select SYN 101',exact:true}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 const panel=page.getByRole('region',{name:'3D aircraft follow'});
 await expect(panel.getByText(/Airbus A350-900/)).toBeVisible();
 await panel.getByText('View controls',{exact:true}).click();
 await page.getByLabel('Follow orbit',{exact:true}).fill('55');
 await page.getByLabel('Follow elevation',{exact:true}).fill('22');
 await panel.getByText('View controls',{exact:true}).click();
 await page.waitForTimeout(1200);
 await page.screenshot({path:'/tmp/changi-model-a350.jpg'});
 await panel.getByText('View controls',{exact:true}).click();
 await page.getByLabel('Follow another aircraft').selectOption({label:'SYN 104'});
 await expect(panel.getByText(/Boeing 777-300ER/)).toBeVisible();
 await page.getByLabel('Follow orbit',{exact:true}).fill('55');
 await page.getByLabel('Follow elevation',{exact:true}).fill('22');
 await panel.getByText('View controls',{exact:true}).click();
 await page.waitForTimeout(1200);
 await page.screenshot({path:'/tmp/changi-model-777.jpg'});
 expect(loaded.has('airbus-a350-900.glb')).toBe(true);expect(loaded.has('boeing-777-300er.glb')).toBe(true);
 await panel.getByText('View controls',{exact:true}).click();
 await page.getByLabel('Follow another aircraft').selectOption({label:'SYN 102'});
 await expect(panel.getByText(/Generic aircraft/)).toBeVisible();
});

for(const genericFails of [false,true])test(`recovers from actual model request failure with ${genericFails?'a position marker':'a generic model'}`,async({page})=>{
 const requests=new Map<string,number>();
 await page.route('**/models/*.glb',async route=>{
  const file=new URL(route.request().url()).pathname.split('/').at(-1)!;
  const count=(requests.get(file)??0)+1;requests.set(file,count);
  if(count>1&&(file==='airbus-a350-900.glb'||(genericFails&&file==='generic-aircraft.glb')))return route.abort();
  return route.continue();
 });
 await page.goto('./');await page.getByRole('button',{name:'Demo',exact:true}).click();
 await page.getByRole('button',{name:'Pause playback'}).click();
 await page.getByRole('button',{name:'Select SYN 101',exact:true}).click();
 await page.getByRole('button',{name:'Follow aircraft',exact:true}).click();
 await expect(page.getByText(genericFails?'Aircraft model unavailable; showing position markers.':'An aircraft-specific model is unavailable; using the generic model.')).toBeVisible({timeout:20000});
 await expect.poll(()=>requests.get('generic-aircraft.glb')??0).toBeGreaterThan(1);
 await expect(page.getByRole('region',{name:'3D aircraft follow'})).toBeVisible();
 await page.screenshot({path:`/tmp/follow-recovered-${genericFails?'marker':'generic'}.jpg`});
});

async function dragCanvas(page: Page, touch: boolean) {
  const canvas = page.locator('.cesium-widget canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x + box.width * 0.26);
  const y = Math.round(box.y + box.height * 0.45);
  const dx = Math.round(Math.min(160, box.width * 0.4));
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx, y: y + 26}]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + 26, {steps: 6});
    await page.mouse.up();
  }
}

async function renderedCamera(page: Page) {
  const offset = await page.evaluate(() => window.__changiBenchmark?.followOffset);
  if (!offset) throw new Error('Missing rendered follow camera sample');
  const {east, north, up} = offset;
  return {
    bearing: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360,
    elevation: Math.atan2(up, Math.hypot(east, north)) * 180 / Math.PI,
    distance: Math.hypot(east, north, up),
  };
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(input + ' follow orbit', () => {
    const touch = input === 'touch';
    test.use({hasTouch: touch, viewport: touch ? {width: 390, height: 844} : {width: 1280, height: 800}});

    test('keeps the dragged view through a 90-degree turn', async ({page}, testInfo) => {
      await page.addInitScript(() => {
        window.__changiBenchmark = {frames: [], ready: false, failed: false, lastRender: 0, aircraftCount: 0, visibleCount: 0};
      });
      await page.route('**/data/changi-demo.json', async route => {
        const response = await route.fetch();
        const fixture = await response.json() as {frames: Snapshot[]};
        const start = fixture.frames[0].scenario_time!;
        for (const frame of fixture.frames) {
          const plane = frame.tracks.find(t => t.latest.callsign === 'SYN 101')!;
          for (const sample of [plane.latest, ...plane.history]) {
            const elapsed = sample.position_time! - start;
            const firstTurn = Math.max(0, Math.min(45, (elapsed - 60) * 9));
            const secondTurn = Math.max(0, Math.min(45, (elapsed - 120) * 9));
            sample.heading_deg = firstTurn + secondTurn;
          }
        }
        await route.fulfill({json: fixture});
      });
      await page.clock.install();
      await page.goto('./');
      await page.getByRole('button', {name: 'Demo', exact: true}).click();
      if (touch) await page.getByRole('button', {name: 'Toggle aircraft list'}).click();
      await page.getByRole('button', {name: 'Select SYN 101', exact: true}).click();
      await page.getByRole('button', {name: 'Follow aircraft', exact: true}).click();
      const panel = page.getByRole('region', {name: '3D aircraft follow'});
      await expect(panel.getByRole('heading', {name: 'SYN 101'})).toBeVisible();
      const heading = panel.locator('.follow-measures > div').filter({hasText: 'Heading'}).locator('strong');
      await expect(heading).toHaveText('0°');
      await dragCanvas(page, touch);

      const orbit = panel.getByLabel('Follow orbit', {exact: true});
      const elevation = panel.getByLabel('Follow elevation', {exact: true});
      await expect.poll(async () => Math.abs(Number(await orbit.inputValue()))).toBeGreaterThan(20);
      const chosen = Number(await orbit.inputValue());
      const tilt = Number(await elevation.inputValue());
      expect(tilt).not.toBe(10);
      const samples = [];
      for (const course of [0, 45, 90]) {
        if (course === 45) await page.clock.fastForward(80_000);
        if (course === 90) await page.clock.fastForward(60_000);
        await expect(heading).toHaveText(course + '°');
        await expect(orbit).toHaveValue(String(chosen));
        await expect(elevation).toHaveValue(String(tilt));
        const expectedBearing = (course + 180 + chosen + 360) % 360;
        await expect.poll(async () => {
          const {bearing} = await renderedCamera(page);
          return Math.abs(((bearing - expectedBearing + 540) % 360) - 180);
        }).toBeLessThan(0.25);
        const camera = await renderedCamera(page);
        expect(camera.distance).toBeCloseTo(180, 0);
        expect(camera.elevation).toBeCloseTo(tilt, 1);
        await expect(panel.getByRole('heading', {name: 'SYN 101'})).toBeVisible();
        samples.push({heading: course, orbit: chosen, ...camera});
        if (course === 45) continue;
        const name = input + (course === 0 ? '-before-turn' : '-after-turn');
        const path = testInfo.outputPath(name + '.png');
        await page.screenshot({path});
        await testInfo.attach(name, {path, contentType: 'image/png'});
      }
      await testInfo.attach('rendered-camera.json', {body: JSON.stringify(samples, null, 2), contentType: 'application/json'});

      const controls = panel.getByText('View controls', {exact: true});
      await controls.click();
      await orbit.fill('170');
      await elevation.fill('58');
      await controls.click();
      await dragCanvas(page, touch);
      await expect(orbit).toHaveValue(String(170 + chosen - 360));
      await expect(elevation).toHaveValue('60');
    });
  });
}

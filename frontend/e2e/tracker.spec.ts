import { test, expect } from "@playwright/test";
import fs from "node:fs";
const fixture = JSON.parse(
  fs.readFileSync("../tests/fixtures/scenarios/changi-demo.json", "utf8"),
);
for (const [provider, label] of [["opensky", "OpenSky"], ["flyitalyadsb", "FlyItalyADSB"]]) {
test(`${label} ground aircraft remain selectable in Cesium 3D with source attribution`, async ({ page }) => {
  const now = Date.now() / 1000;
  const frame = structuredClone(fixture.frames[0]);
  Object.assign(frame, { mode: "live", scenario_time: null, server_time: now });
  Object.assign(frame.status, { mode: "live", upstream_state: "healthy", sources: {
    [provider]: { enabled: true, state: "healthy", error_code: null, last_attempt: now, last_success: now, next_retry: now + 30, requests: 1, remaining_credits: 3999 },
  } });
  const track = frame.tracks[0];
  track.id = "live:icao24:abc123";
  track.latest = { ...track.latest, id: track.id, mode: "live", provider, provider_id: "abc123", callsign: "GROUND TEST", ground: true, lat: 1.36, lon: 103.99, position_time: now, provider_time: now, receipt_time: now };
  track.history = [track.latest];
  frame.tracks = [track];
  await page.routeWebSocket("**/ws/aircraft", ws => ws.send(JSON.stringify(frame)));
  await page.goto("/");
  await page.getByRole("button", { name: "Ground", exact: true }).click();
  await page.getByRole("button", { name: "Select GROUND TEST" }).click();
  await expect(page.getByRole("region", { name: "Selected aircraft details" }).getByText(provider, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.getByRole("button", { name: "2D", exact: true })).toBeVisible();
  await expect(page.locator(".cesium-widget canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Airborne", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select GROUND TEST" })).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator(".statusbar").getByRole("link",{name:label,exact:true})).toBeVisible();
  const sourceButton=await page.getByRole("button",{name:"Sources & accuracy",exact:true}).boundingBox();
  expect(sourceButton!.x + sourceButton!.width).toBeLessThanOrEqual(390);
});
}
test("live unavailable never invents aircraft; explicit demo is isolated and searchable", async ({
  page,
}) => {
  const unavailable = structuredClone(fixture.frames[0]);
  Object.assign(unavailable, { mode: "live", scenario_time: null, server_time: Date.now() / 1000, tracks: [] });
  Object.assign(unavailable.status, { mode: "live", upstream_state: "unavailable", error_code: "503", last_success: null });
  await page.routeWebSocket("**/ws/aircraft", ws => ws.send(JSON.stringify(unavailable)));
  await page.goto("/");
  await expect(
    page.getByText("LIVE DATA UNAVAILABLE", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Select SYN/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Select SYN/ })).toHaveCount(
    16,
  );
  await page.getByRole("textbox", { name: "Search aircraft" }).fill("SYN 105");
  await expect(page.getByRole("button", { name: /Select SYN/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Select SYN 105" }).click();
  await expect(
    page.getByRole("region", { name: "Selected aircraft details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByRole("button", { name: /Select SYN/ })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Selected aircraft details" }),
  ).toHaveCount(0);
});
test("follow, pause, seek, lighting and keyboard exit preserve observation time", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  await page.getByRole("button", { name: "Pause playback" }).click();
  const clock = await page.locator(".header-right time").innerText();
  await page
    .getByRole("button", { name: "Follow aircraft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop following" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Follow aircraft", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to day" }).click();
  expect(await page.locator(".header-right time").innerText()).toBe(clock);
  await page.getByRole("button", { name: "Switch to night" }).click();
  expect(await page.locator(".header-right time").innerText()).toBe(clock);
  await page
    .getByRole("slider", { name: "Scenario timeline" })
    .fill(String(fixture.epoch + 40));
  await expect(
    page.getByText("Final approach candidate", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Restart playback" }).click();
  expect(
    await page.getByRole("slider", { name: "Scenario timeline" }).inputValue(),
  ).toBe(String(fixture.epoch));
});
test("heartbeat cannot renew a lost position or keep following it", async ({
  page,
}) => {
  const now = Date.now() / 1000;
  const f = structuredClone(fixture.frames[4]);
  f.mode = "live";
  f.status.mode = "live";
  f.status.upstream_state = "healthy";
  f.epoch = "test";
  f.server_time = now;
  f.scenario_time = null;
  f.tracks = f.tracks.slice(0, 1).map((t: any) => {
    t.id = "live:adsb.fi:abc";
    for (const o of [...t.history, t.latest]) {
      o.id = t.id;
      o.mode = "live";
      o.provider = "adsb.fi";
      o.position_time = now;
      o.receipt_time = now;
    }
    return t;
  });
  let channel: any;
  await page.routeWebSocket("**/ws/aircraft", (ws) => {
    channel = ws;
    ws.send(JSON.stringify(f));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  await page
    .getByRole("button", { name: "Follow aircraft", exact: true })
    .click();
  channel.send(
    JSON.stringify({
      type: "heartbeat",
      epoch: "test",
      sequence: f.sequence,
      server_time: now + 121,
      status: f.status,
    }),
  );
  await expect(page.getByText(/Track lost ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop following" }),
  ).toHaveCount(0);
});
test("GPU failure retains a readable functional aircraft list", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: any,
      ...args: any[]
    ) {
      if (String(type).includes("webgl")) return null;
      return (original as any).apply(this, [type, ...args]);
    } as any;
  });
  await page.goto("/");
  await expect(page.getByText(/WebGL is unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  await expect(
    page.getByRole("region", { name: "Selected aircraft details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Follow aircraft", exact: true }),
  ).toBeDisabled();
});
test("mobile controls stay inside viewport and selection opens readable details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Toggle aircraft list" }).click();
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  const panel = page.getByRole("region", { name: "Selected aircraft details" });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../docs/evidence/mobile-details.png" });
});

test("live provider credit stays visible on mobile with the traffic panel closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".statusbar").getByRole("link", { name: "ADSB.fi" })).toBeVisible();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.locator(".statusbar").getByRole("link", { name: "ADSB.fi" })).toHaveCount(0);
});

for (const viewport of [{width:1440,height:800},{width:390,height:844}]) {
test(`regional overview includes edge aircraft at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const now = Date.now() / 1000;
  const snapshot = structuredClone(fixture.frames[0]);
  Object.assign(snapshot, { mode: "live", scenario_time: null, server_time: now });
  Object.assign(snapshot.status, { mode: "live", upstream_state: "healthy" });
  snapshot.tracks = [[2.86,103.99],[-0.14,103.99],[1.36,102.49],[1.36,105.49]].map(([lat,lon],i) => {
    const t = structuredClone(fixture.frames[0].tracks[0]);
    t.id = `live:adsb.fi:edge${i}`;
    t.history = [];
    Object.assign(t.latest, {id:t.id, mode:"live", provider:"adsb.fi", provider_id:`edge${i}`, callsign:`EDGE ${i}`, lat, lon, position_time:now, receipt_time:now});
    return t;
  });
  await page.routeWebSocket("**/ws/aircraft", ws => ws.send(JSON.stringify(snapshot)));
  await page.addInitScript(() => { (window as any).__changiBenchmark = {frames:[],failed:false,ready:false,aircraftCount:0,visibleCount:0,lastRender:0}; });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as any).__changiBenchmark.aircraftCount)).toBe(4);
  await expect.poll(() => page.evaluate(() => (window as any).__changiBenchmark.visibleCount)).toBe(4);
  await expect(page.locator(".region-badge")).toHaveText("100 NM");
  const before3D = await page.evaluate(() => (window as any).__changiBenchmark.lastRender);
  await page.getByRole("button",{name:"3D",exact:true}).click();
  await expect(page.getByRole("button",{name:"2D",exact:true})).toBeVisible();
  await page.waitForFunction(time => (window as any).__changiBenchmark.lastRender > time, before3D);
  const beforeOverview = await page.evaluate(() => (window as any).__changiBenchmark.lastRender);
  await page.getByRole("button",{name:"Regional overview"}).click();
  await expect(page.getByRole("button",{name:"3D",exact:true})).toBeVisible();
  await page.waitForFunction(time => (window as any).__changiBenchmark.lastRender > time, beforeOverview);
  await expect.poll(() => page.evaluate(() => (window as any).__changiBenchmark.visibleCount)).toBe(4);
});
}

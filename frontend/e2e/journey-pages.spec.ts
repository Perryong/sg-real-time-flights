import { expect, test } from "@playwright/test";
import fs from "node:fs";
import type { Snapshot } from "../src/data/types";
import type { Journey } from "../src/journey/types";
import { visibleMarkers } from "./visibleMarkers";

const leg: Journey = JSON.parse(fs.readFileSync("../tests/fixtures/journeys/sia132-20250518.json", "utf8"));
const demo: {frames: Snapshot[]} = JSON.parse(fs.readFileSync("../tests/fixtures/scenarios/changi-demo.json", "utf8"));
const observation = leg.points[1];

for (const mobile of [false, true]) {
  test.describe(mobile ? "phone" : "desktop", () => {
    test.use({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 900}, hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce"});

    test("tracks a dated international departure through regional exit", async ({page}, testInfo) => {
      test.setTimeout(90_000);
      const frame = structuredClone(demo.frames[0]);
      const now = observation.time;
      const [track] = frame.tracks;
      Object.assign(frame, {mode: "live", scenario_time: null, server_time: now, tracks: [track]});
      Object.assign(frame.status, {mode: "live", upstream_state: "healthy", newest_position_time: now});
      track.id = "live:icao24:76b4ec";
      Object.assign(track.latest, {id: track.id, provider_id: "76b4ec", mode: "live", callsign: "SIA132",
        provider: "ADSB.lol archive replay", aircraft_type: "B738", registration: "9V-MGL", position_time: now,
        receipt_time: now, lat: observation.lat, lon: observation.lon, alt_baro_m: observation.altitude_ft! * 0.3048 });
      track.history = [track.latest];

      let exited = false;
      const queries: URLSearchParams[] = [];
      await page.clock.install({time: new Date(now * 1000)});
      await page.route("**/api/aircraft*", route => route.fulfill({json: {
        ...frame, sequence: exited ? 2 : 1, tracks: exited ? [] : [track],
      }}));
      await page.route("**/api/weather*", route => route.fulfill({status: 503, body: ""}));
      await page.route("**/api/journey?*", route => {
        queries.push(new URL(route.request().url()).searchParams);
        return route.fulfill({json: {journey: exited ? leg : {...leg, status: "airborne", points: leg.points.slice(0, 20)}}});
      });
      await page.goto("./");
      await expect(page.locator(".cesium-widget canvas")).toBeVisible();
      if (mobile) {
        const controls = page.getByRole("group", {name:"Map panels"});
        const collapse = controls.getByRole("button", {name:"Collapse panels"});
        if (await collapse.isVisible()) await collapse.tap();
        await expect.poll(async () => (await visibleMarkers(page)).amber.length, {timeout: 20_000}).toBeGreaterThan(8);
        const points = (await visibleMarkers(page)).amber;
        const mid = points[Math.floor(points.length / 2)];
        await page.touchscreen.tap(mid.x, mid.y);
      } else {
        await page.getByRole("button", {name:"Select SIA132"}).click();
      }
      const panel = page.getByRole("region", {name:"Flight journey"});
      await expect(panel.getByText("Intended arrival")).toBeVisible();
      await expect(panel.getByText("PEN", {exact:true})).toBeVisible();
      await panel.getByRole("button", {name:"Fit journey"}).click();
      if (mobile) {
        const chart = panel.locator(".journey-plot");
        await chart.tap({position:{x:65,y:30}});
        await expect(panel.getByText("Selected point")).toBeVisible();
      }
      await page.clock.runFor(2_000);
      await page.waitForLoadState("networkidle", {timeout:8000}).catch(() => {});
      await page.screenshot({path: testInfo.outputPath("partial.png")});

      exited = true;
      await page.clock.fastForward(16_000);
      await expect(page.getByText("LAST REGIONAL CONTACT")).toBeVisible();
      await expect(panel.getByText("Intended arrival")).toBeVisible();
      await page.clock.fastForward(300_000);
      await expect(panel.getByText("Arrival", {exact:true})).toBeVisible();
      expect(queries.at(-1)?.get("id")).toBe(leg.id);
      expect(queries.at(-1)?.get("observed_at")).toBe(String(Math.floor(now)));
      const slider = panel.getByRole("slider", {name:"Altitude observation"});
      await panel.getByRole("button", {name:"Fit journey"}).click();
      const penang = leg.points.findLast(point => point.altitude_ft !== null)!;
      // Move the chart cursor to the last measured approach altitude outside the regional circle.
      await slider.focus();
      await slider.press("End");
      for (let i = leg.points.length - 1; i > leg.points.indexOf(penang); i--) await slider.press("ArrowLeft");
      await expect(slider).toHaveAttribute("aria-valuetext", new RegExp(penang.altitude_ft!.toLocaleString("en-US") + " ft"));
      await expect(panel.getByText(/track gaps/)).toBeVisible();
      await panel.getByRole("button", {name:"Fit journey"}).click();
      await page.clock.runFor(2_000);
      await page.waitForLoadState("networkidle", {timeout:8000}).catch(() => {});
      await page.screenshot({path:testInfo.outputPath("completed.png")});
      await page.clock.fastForward(300_000);
      expect(queries.filter(query => query.has("id"))).toHaveLength(1);
    });

    test("switches from an arrival to an overflight and keeps usual routes separate", async ({page}) => {
      const now = Math.floor(Date.now() / 1000);
      const frame = structuredClone(demo.frames[0]);
      Object.assign(frame, {mode:"live", scenario_time:null, server_time:now});
      Object.assign(frame.status, {mode:"live", upstream_state:"healthy", newest_position_time:now});
      const callsigns = ["TEST131", "TEST901", "TEST225", null];
      frame.tracks = callsigns.map((callsign, index) => {
        const track = structuredClone(frame.tracks[0]);
        const hex = "abcd0" + index;
        track.id = "live:icao24:" + hex;
        Object.assign(track.latest, {id:track.id, provider:"Test feed", provider_id:hex, mode:"live", callsign,
          position_time:now, receipt_time:now, lat:1.48, lon:103.94 + index * 0.1,
          route:callsign === "TEST225" ? {provider:"flyitalyadsb",callsign,origin:"WMKP",destination:"WSSS",
            origin_iata:"PEN",destination_iata:"SIN",observed_count:9,last_seen_day:new Date(now*1000).toISOString().slice(0,10),retrieved_at:now} : null});
        track.history = [track.latest];
        return track;
      });
      const requests: string[] = [];
      await page.route("**/api/aircraft*", route => route.fulfill({json:frame}));
      await page.route("**/api/weather*", route => route.fulfill({status:503,body:""}));
      await page.route("**/api/journey?*", route => {
        const callsign = new URL(route.request().url()).searchParams.get("callsign")!;
        requests.push(callsign);
        // Separate synthetic routes exercise an arrival and a flight passing Singapore.
        const airport = callsign === "TEST131" ? leg.origin : {icao:"WIII",iata:"CGK",name:"Soekarno–Hatta",city:"Jakarta",lat:-6.13,lon:106.66};
        const journey = callsign === "TEST225" ? null : {id:callsign,callsign,status:"airborne",source:"Test provider",
          origin: callsign === "TEST131" ? null : leg.destination,destination:airport, points:[
            {time:now,lat:1.48,lon:103.94,altitude_ft:15000,estimated:false}]};
        return route.fulfill({json:{journey}});
      });
      await page.goto("./");
      const panel = page.getByRole("region",{name:"Flight journey"});
      for (const [index, callsign] of callsigns.entries()) {
        if (mobile) await page.getByRole("group",{name:"Map panels"}).getByRole("button",{name:"Traffic",exact:true}).click();
        await page.getByRole("button",{name:"Select " + (callsign ?? "abcd03"),exact:true}).click();
        if (index < 2) {
          await expect(panel.getByText(index === 0 ? "SIN" : "CGK",{exact:true})).toBeVisible();
          await expect(panel.getByText(index === 0 ? "Unknown airport" : "PEN",{exact:true})).toBeVisible();
        } else {
          await expect(panel.getByText("Regional observations")).toBeVisible();
          await expect(panel.getByText("Unknown airport")).toHaveCount(2);
          if (callsign) await expect(page.getByText(/Historical route · FlyItalyADSB/)).toBeVisible();
        }
      }
      expect(requests).toEqual(callsigns.filter(Boolean));
    });
  });
}

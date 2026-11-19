import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__changiBenchmark = {
    frames: [],
    ready: false,
    failed: false,
    lastRender: 0,
    aircraftCount: 0,
    visibleCount: 0,
  };
});
const start = Date.now();
await page.goto("http://127.0.0.1:4177/");
await page.waitForFunction(() => window.__changiBenchmark.frames.length > 2);
const cold = (Date.now() - start) / 1000;
const warmStart = Date.now();
await page.reload();
await page.waitForFunction(() => window.__changiBenchmark.frames.length > 2);
const warm = (Date.now() - warmStart) / 1000;
await page.getByRole("button", { name: "Demo", exact: true }).click();
await page.getByRole("button", { name: "Select SYN 101" }).waitFor();
await page.getByRole("button", { name: "Pause playback" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "../docs/evidence/overview.png" });
for (const runway of ["02C / 20C", "02L / 20R", "02R / 20L"]) {
  await page.getByRole("button", { name: "Map layers", exact: true }).click();
  await page.getByRole("button", { name: runway, exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `../docs/evidence/runway-${runway.slice(0, 3)}.png`,
  });
}
await page.getByRole("button", { name: "Select SYN 101" }).click();
await page
  .getByRole("button", { name: "Follow aircraft", exact: true })
  .click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "../docs/evidence/follow-aircraft.png" });
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Close aircraft details" }).click();
await page.getByRole("button", { name: "Regional overview" }).click();
await page.getByRole("button", { name: "Switch to day" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "../docs/evidence/day-map.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.getByRole("button", { name: "Demo", exact: true }).click();
await page.getByRole("button", { name: "Pause playback" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "../docs/evidence/mobile-map.png" });
const gl = await page.evaluate(() => {
  const c = document.querySelector(".map-canvas canvas"),
    g = c.getContext("webgl2"),
    e = g?.getExtension("WEBGL_debug_renderer_info");
  return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown";
});
const report = {
  browser: "Installed Google Chrome " + browser.version(),
  renderer: gl,
  cold_local_scene_seconds: cold,
  warm_local_scene_seconds: warm,
  errors,
  checks: [
    "Live unavailable",
    "explicit demo",
    "all three runway camera controls",
    "follow and Escape",
    "day/night presentation",
    "390px geographic layout",
  ],
  limitations:
    "Local bundle/geometry readiness, not a remote-network SLA or authoritative geometry validation",
};
fs.writeFileSync(
  "../docs/evidence/browser-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
await browser.close();
if (errors.length) process.exitCode = 1;

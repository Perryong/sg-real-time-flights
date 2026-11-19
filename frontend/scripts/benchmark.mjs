import { chromium } from "@playwright/test";
import fs from "node:fs";
import { summarizeScene } from "../src/scene/performance.ts";
const duration = Number(process.argv[2] ?? 300),
  count = 100;
const template = JSON.parse(
  fs.readFileSync("../tests/fixtures/scenarios/changi-demo.json", "utf8"),
).frames.at(-1);
const browser = await chromium.launch({
  channel: process.env.BENCH_CHANNEL || undefined,
  headless: true,
  args: ["--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
let seq = 0;
const timers = new Set();
function makeFrame() {
  const now = Date.now() / 1000;
  const f = {
    ...template,
    mode: "live",
    epoch: "synthetic-benchmark",
    sequence: ++seq,
    server_time: now,
    scenario_time: null,
    status: {
      ...template.status,
      mode: "live",
      upstream_state: "healthy",
      message: "SYNTHETIC BENCHMARK — NOT LIVE",
    },
    tracks: [],
  };
  for (let i = 0; i < count; i++) {
    const id = `live:fixture:bench${i}`;
    const base = template.tracks[i % 16];
    const history = [];
    for (let j = 60; j >= 0; j--) {
      const time = now - j * 5;
      const angle = (i / count) * Math.PI * 2;
      history.push({
        ...base.latest,
        id,
        mode: "live",
        provider: "synthetic-benchmark",
        provider_id: `bench${i}`,
        callsign: `BENCH ${i}`,
        lat: 1.36 + Math.sin(angle) * 0.21 + (time % 3600) * 0.000001,
        lon: 103.99 + Math.cos(angle) * 0.27,
        position_time: time,
        provider_time: time,
        receipt_time: time,
        session_id: "bench",
      });
    }
    f.tracks.push({
      ...base,
      id,
      session_id: "bench",
      latest: history.at(-1),
      history,
    });
  }
  return f;
}
await page.routeWebSocket("**/ws/aircraft", (ws) => {
  ws.send(JSON.stringify(makeFrame()));
  const timer = setInterval(() => {
    try {
      ws.send(JSON.stringify(makeFrame()));
    } catch {}
  }, 10000);
  timers.add(timer);
  ws.onClose(() => {
    clearInterval(timer);
    timers.delete(timer);
  });
});
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
await page.goto(process.env.BENCH_URL ?? "http://127.0.0.1:4177/");
await page.getByRole("button", { name: "Select BENCH 0", exact: true }).click();
await page.evaluate(() => {
  const label = document.createElement("div");
  label.textContent = "SYNTHETIC PERFORMANCE TEST — NOT LIVE";
  label.style.cssText =
    "position:fixed;top:0;left:40%;z-index:9999;background:#ffc;color:#111;padding:5px";
  document.body.append(label);
});
await page.waitForTimeout(10000);
const cdp = await page.context().newCDPSession(page);
if (process.env.PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
}
await page.waitForFunction(
  () =>
    window.__changiBenchmark?.ready &&
    window.__changiBenchmark.aircraftCount === 100,
);
await page.evaluate(() => {
  window.__changiBenchmark.frames = [];
  window.__bench = { heaps: [] };
});
if (process.env.INDUCE_CONTEXT_LOSS)
  await page
    .locator(".map-canvas canvas")
    .evaluate((canvas) =>
      canvas
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext(),
    );
for (let elapsed = 0; elapsed < duration; elapsed += 10) {
  await page.waitForTimeout(Math.min(10, duration - elapsed) * 1000);
  await page.evaluate(() => {
    window.__bench.heaps.push(performance.memory?.usedJSHeapSize ?? null);
  });
}
const measured = await page.evaluate(() => {
  const b = window.__bench;
  window.__bench = null;
  const canvas = document.createElement("canvas"),
    gl = canvas.getContext("webgl2"),
    ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    ...b,
    metrics: window.__changiBenchmark,
    measuredAt: performance.now(),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
  };
});
if (process.env.PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  const counts = new Map();
  for (const id of profile.samples ?? [])
    counts.set(id, (counts.get(id) ?? 0) + 1);
  console.log(
    profile.nodes
      .map((n) => ({
        name: n.callFrame.functionName,
        url: n.callFrame.url,
        line: n.callFrame.lineNumber,
        hits: counts.get(n.id) ?? 0,
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 25),
  );
}
await cdp.send("HeapProfiler.collectGarbage");
const retainedHeap = await page.evaluate(
  () => performance.memory?.usedJSHeapSize ?? null,
);
const scene = summarizeScene(measured.metrics, measured.measuredAt, count);
if (!scene.valid)
  errors.push(
    "Invalid scene measurement: renderer failed, stopped, or aircraft count did not match",
  );
const result = {
  duration_seconds: duration,
  url: process.env.BENCH_URL ?? "http://127.0.0.1:4177/",
  ...scene,
  measurement:
    "Cesium postRender events; actual entity and geographic view counts",
  history_seconds: 300,
  displayed_trails: "selected aircraft only (product behavior)",
  viewport: "1920x1080",
  browser: browser.version(),
  renderer: measured.renderer,
  heap_samples: measured.heaps,
  retained_heap_after_gc: retainedHeap,
  errors,
  transport:
    "Playwright synthetic WebSocket messages, no external aircraft feed",
  target_30fps: scene.valid && scene.mean_fps >= 30,
};
fs.writeFileSync(
  process.env.BENCH_OUTPUT ??
    (process.env.PROFILE
      ? "../.superpowers/profile.json"
      : "../docs/evidence/browser-performance.json"),
  JSON.stringify(result, null, 2) + "\n",
);
await page.screenshot({ path: "../docs/evidence/benchmark-100-aircraft.png" });
for (const t of timers) clearInterval(t);
await browser.close();
console.log(
  JSON.stringify(
    { ...result, heap_samples: result.heap_samples.length },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;

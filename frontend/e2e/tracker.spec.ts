import { test, expect } from "@playwright/test";
import fs from "node:fs";
const fixture = JSON.parse(
  fs.readFileSync("../tests/fixtures/scenarios/changi-demo.json", "utf8"),
);
test("live unavailable never invents aircraft; explicit demo is isolated and searchable", async ({
  page,
}) => {
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
    t.id = "live:airplanes.live:abc";
    for (const o of [...t.history, t.latest]) {
      o.id = t.id;
      o.mode = "live";
      o.provider = "airplanes.live";
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

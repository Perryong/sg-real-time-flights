import { test, expect } from "@playwright/test";
test("Cesium serves real assets and a visible geographic canvas", async ({
  page,
  request,
}) => {
  const asset = await request.get(
    "/cesium/Assets/approximateTerrainHeights.json",
  );
  expect(asset.headers()["content-type"]).toContain("json");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page
      .getByRole("region", { name: "Singapore geographic flight map" })
      .locator("canvas"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Select SYN 101" }),
  ).toBeVisible();
  await expect(
    page.getByText("SIMULATED · NOT LIVE", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("missing aircraft mesh uses markers and explains degraded detail", async ({
  page,
}) => {
  await page.route("**/models/generic-aircraft.glb", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByText(/Aircraft model unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  await expect(
    page.getByRole("region", { name: "Selected aircraft details" }),
  ).toBeVisible();
});

test("context loss stops follow and invalidates actual scene performance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__changiBenchmark = {
      frames: [],
      failed: false,
      ready: false,
      aircraftCount: 0,
      visibleCount: 0,
      lastRender: 0,
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Select SYN 101" }).click();
  await page
    .getByRole("button", { name: "Follow aircraft", exact: true })
    .click();
  await page.waitForFunction(
    () => (window as any).__changiBenchmark.frames.length > 2,
    {},
    { timeout: 5000 },
  );
  const lost = await page
    .locator(".map-canvas canvas")
    .evaluate((canvas: any) => {
      const gl = canvas.getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_lose_context");
      ext?.loseContext();
      return !!ext;
    });
  expect(lost).toBe(true);
  await expect(
    page.getByRole("button", { name: "Follow aircraft", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).__changiBenchmark.failed),
  ).toBe(true);
  const frames = await page.evaluate(
    () => (window as any).__changiBenchmark.frames.length,
  );
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => (window as any).__changiBenchmark.frames.length),
  ).toBe(frames);
});

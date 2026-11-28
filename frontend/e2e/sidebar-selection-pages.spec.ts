import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Snapshot } from "../src/data/types";

const canvasSelector = ".cesium-widget canvas";
const mapTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA8klEQVR42u3SMQ0AAAjAMPxL5CEoARsk9JiBpdGVo7+FCQAYAYAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAgAAEwAwAgABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQDdaBMdNe3wDX8QAAAAASUVORK5CYII=",
  "base64",
);
const callsigns = ["SYN 103", "SYN 104"];

async function useDemo(page: Page, prepareFrame?: (frame: Snapshot) => void) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: mapTile }),
  );
  await page.route("**/changi-demo*", async (route) => {
    const response = await route.fetch();
    const scenario: { frames: Snapshot[] } = await response.json();
    for (const frame of scenario.frames) {
      if (prepareFrame) prepareFrame(frame);
      else frame.tracks = frame.tracks.filter((track) => callsigns.includes(track.latest.callsign ?? ""));
    }
    await route.fulfill({ response, json: scenario });
  });
}

async function visibleMarkers(page: Page) {
  const image = await page.screenshot({ scale: "css" });
  return page.evaluate(async ({ png, canvasSelector }) => {
    const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + png)).blob());
    const pixels = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
    pixels.drawImage(bitmap, 0, 0);
    const { data, width } = pixels.getImageData(0, 0, bitmap.width, bitmap.height);
    const map = document.querySelector(canvasSelector);
    const lime = [];
    const amber = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // The map's edge gradient dims the lime marker on compact screens.
      const selected = g >= 200 && Math.abs(r / g - 197 / 246) < 0.015 && Math.abs(b / g - 140 / 246) < 0.015;
      const ordinary = r >= 212 && r <= 239 && r - g >= 33 && g - b >= 70 && b >= 104 && b <= 120;
      if (!selected && !ordinary) continue;
      const point = { x: (i / 4) % width, y: Math.floor(i / 4 / width) };
      if (document.elementFromPoint(point.x, point.y) !== map) continue;
      if (selected) lime.push(point);
      else amber.push(point);
    }
    return { lime, amber };
  }, { png: image.toString("base64"), canvasSelector });
}

async function tapOrClick(locator: Locator, mobile: boolean) {
  if (mobile) await locator.tap();
  else await locator.click();
}

async function pan(page: Page, mobile: boolean, start: { x: number; y: number }) {
  const x = start.x > 200 ? 80 : 320;
  if (!mobile) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(x, start.y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let step = 1; step <= 6; step++) {
    const point = { x: start.x + (x - start.x) * step / 6, y: start.y };
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["touch", 390, 844],
  ["compact touch", 320, 568],
] as const) {
  const mobile = name !== "desktop";
  test.describe(name, () => {
    test.use({
      viewport: { width, height },
      hasTouch: mobile,
      isMobile: mobile,
      reducedMotion: "reduce",
    });

    test("locates and highlights the chosen demo aircraft again after a pan", async ({ page }, testInfo) => {
      await useDemo(page);
      const details = page.getByRole("region", { name: "Selected aircraft details" });
      const traffic = page.getByRole("region", { name: "Aircraft list" });
      const toggleList = page.getByRole("button", { name: "Toggle aircraft list" });
      const row = (callsign: string) => traffic.getByRole("button", { name: "Select " + callsign, exact: true });
      const openList = async () => {
        if (!(await traffic.isVisible())) await tapOrClick(toggleList, mobile);
        await expect(traffic).toBeVisible();
      };
      const selectedMarker = async () => {
        await expect.poll(async () => (await visibleMarkers(page)).lime.length).toBeGreaterThan(8);
        const { lime } = await visibleMarkers(page);
        const minX = Math.min(...lime.map(({ x }) => x));
        const maxX = Math.max(...lime.map(({ x }) => x));
        expect(maxX - minX).toBeLessThan(42);
        return { x: (minX + maxX) / 2, y: lime.reduce((sum, point) => sum + point.y, 0) / lime.length };
      };

      await page.goto("./");
      await tapOrClick(page.getByRole("button", { name: "Demo", exact: true }), mobile);
      const timeline = page.getByRole("slider", { name: "Scenario timeline" });
      await expect(timeline).toHaveAttribute("min", "1700000000");
      await tapOrClick(page.getByRole("button", { name: "Pause playback" }), mobile);
      await expect(page.locator(canvasSelector)).toBeVisible();
      if (await traffic.isVisible()) await tapOrClick(toggleList, mobile);
      await expect.poll(async () => (await visibleMarkers(page)).amber.length).toBeGreaterThan(8);
      for (let i = 0; i < 11; i++) await tapOrClick(page.getByRole("button", { name: "Zoom in" }), mobile);
      await expect.poll(async () => (await visibleMarkers(page)).amber.length).toBe(0);
      await openList();

      for (const callsign of callsigns) {
        await tapOrClick(row(callsign), mobile);
        await expect(details.getByRole("heading", { name: callsign })).toBeVisible();
        const marker = await selectedMarker();
        const screenshot = await page.screenshot({ path: testInfo.outputPath(callsign + ".png") });
        await testInfo.attach(callsign, { body: screenshot, contentType: "image/png" });

        // Clear the selection and pick the rendered aircraft at the same point.
        await tapOrClick(details.getByRole("button", { name: "Close aircraft details" }), mobile);
        if (mobile) await page.touchscreen.tap(marker.x, marker.y);
        else await page.mouse.click(marker.x, marker.y);
        await expect(details.getByRole("heading", { name: callsign })).toBeVisible();
        await expect(page.getByRole("region", { name: "3D aircraft follow" })).toHaveCount(0);
        await openList();
        await expect(row(callsign)).toHaveClass(/\bselected\b/);
        await expect(traffic.locator(".flight-row.selected")).toHaveCount(1);
      }

      if (mobile) await tapOrClick(toggleList, mobile);
      const lastMarker = await selectedMarker();
      await pan(page, mobile, lastMarker);
      if (mobile) await pan(page, mobile, lastMarker);
      await expect.poll(async () => (await visibleMarkers(page)).lime.length).toBe(0);
      const originalTime = Number(await timeline.inputValue());
      await timeline.press("PageUp");
      await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(originalTime + 5);
      await expect(details.getByRole("heading", { name: "SYN 104" })).toBeVisible();
      await expect.poll(async () => (await visibleMarkers(page)).lime.length).toBe(0);

      await openList();
      await tapOrClick(row("SYN 104"), mobile);
      await selectedMarker();
      await tapOrClick(details.getByRole("button", { name: "Follow aircraft" }), mobile);
      await expect(page.getByRole("region", { name: "3D aircraft follow" }).getByRole("heading", { name: "SYN 104" })).toBeVisible();
    });
  });
}

test("moves an aircraft out from behind the sidebar or globe", async ({ page }) => {
  const westOfChangi = { lat: 1.3644, lon: 99.2 };
  const oppositeSide = { lat: -1.3644, lon: -76.0085 };
  const positions = new Map([
    [callsigns[0], westOfChangi],
    [callsigns[1], oppositeSide],
    ["SYN 105", { ...oppositeSide, lon: -75.7 }],
  ]);
  await useDemo(page, (frame) => {
    frame.tracks = frame.tracks.filter((track) => positions.has(track.latest.callsign ?? ""));
    for (const track of frame.tracks) {
      const position = positions.get(track.latest.callsign!)!;
      for (const observation of [track.latest, ...track.history]) Object.assign(observation, position);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Scenario timeline" })).toHaveAttribute("min", "1700000000");
  await page.getByRole("button", { name: "Pause playback" }).click();
  const toggleList = page.getByRole("button", { name: "Toggle aircraft list" });
  const list = (await page.getByRole("region", { name: "Aircraft list" }).boundingBox())!;
  const markersUnderList = async () => (await visibleMarkers(page)).amber.filter(({ x, y }) =>
    x > list.x && x < list.x + list.width && y > list.y && y < list.y + list.height,
  ).length;
  await toggleList.click();
  await expect.poll(markersUnderList).toBeGreaterThan(8);
  await toggleList.click();
  await expect.poll(markersUnderList).toBe(0);

  const details = page.getByRole("region", { name: "Selected aircraft details" });
  const inView = page.getByText("IN VIEW", { exact: true }).locator("..");
  await expect(inView).toHaveText("1IN VIEW");
  for (const callsign of callsigns) {
    await page.getByRole("button", { name: "Select " + callsign }).click();
    await expect(details.getByRole("heading", { name: callsign })).toBeVisible();
    await expect.poll(async () => (await visibleMarkers(page)).lime.length).toBeGreaterThan(8);
  }
  await expect(inView).toHaveText("2IN VIEW");
});

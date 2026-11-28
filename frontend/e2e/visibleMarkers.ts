import type { Page } from "@playwright/test";

const canvasSelector = ".cesium-widget canvas";

export async function visibleMarkers(page: Page) {
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

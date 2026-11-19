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

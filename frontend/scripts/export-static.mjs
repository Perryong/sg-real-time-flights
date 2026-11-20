import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = new URL("../../", import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const airport = await read("data/airport/manifest.json");
for (const layer of ["runways", "taxiways", "buildings"])
  airport[layer] = await read(`data/airport/${layer}.geojson`);
const demo = await read("tests/fixtures/scenarios/changi-demo.json");
const recorded = structuredClone(demo);
for (const frame of recorded.frames) {
  frame.mode = frame.status.mode = "recorded";
  frame.status.upstream_state = "recorded";
  frame.epoch = "recorded-synthetic-test-v1";
  for (const track of frame.tracks) {
    track.id = track.id.replace("simulated:", "recorded:");
    for (const o of [track.latest, ...track.history]) { o.mode = "recorded"; o.id = track.id; }
  }
}
const destination = new URL("frontend/public/data/", root);
await mkdir(destination, {recursive:true});
for (const [name, data] of Object.entries({airport, "changi-demo":demo, "recorded-test":recorded}))
  await writeFile(new URL(`${name}.json`, destination), JSON.stringify(data));
console.log("Exported airport geometry and synthetic fixtures for static hosting.");

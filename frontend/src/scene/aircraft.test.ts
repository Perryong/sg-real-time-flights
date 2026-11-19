import { expect, it } from "vitest";
import { EntityCollection, JulianDate, type Viewer } from "cesium";
import { AircraftLayer } from "./aircraft";
import { track } from "../data/testHelpers";
it("allocates a static observation trail only for the selected aircraft", () => {
  const entities = new EntityCollection();
  const viewer = {
    entities,
    scene: { primitives: { add: (p: unknown) => p, remove: () => true } },
    camera: { positionCartographic: { height: 125000 } },
  } as unknown as Viewer;
  const layer = new AircraftLayer(viewer, () => 1020),
    t = track();
  layer.update([t], null, true);
  expect(layer.entities.get(t.id)?.polyline).toBeUndefined();
  layer.update([t], t.id, true);
  const line = layer.entities.get(t.id)!.polyline!;
  expect(line.positions?.isConstant).toBe(true);
  expect(line.positions?.getValue(JulianDate.now())).toHaveLength(2);
  layer.update([t], t.id, false);
  expect(layer.entities.get(t.id)?.polyline).toBeUndefined();
  layer.clear();
  expect(entities.values).toHaveLength(0);
});

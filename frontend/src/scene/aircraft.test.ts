import { expect, it } from "vitest";
import {
  Cartographic,
  EntityCollection,
  JulianDate,
  type Viewer,
} from "cesium";
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
it("uses the buffered ground state rather than a newer ground report", () => {
  const entities = new EntityCollection();
  const viewer = {
    entities,
    scene: { primitives: { add: (p: unknown) => p, remove: () => true } },
    camera: { positionCartographic: { height: 125000 } },
  } as unknown as Viewer;
  const layer = new AircraftLayer(viewer, () => 1025),
    t = track([1010, 1020, 1025]);
  t.latest = {
    ...t.history[2],
    ground: true,
    alt_geom_m: null,
    alt_baro_m: null,
  };
  t.history[2] = t.latest;
  const p = Cartographic.fromCartesian(layer.position(t));
  expect(p.height).toBeCloseTo(1000, 3);
  layer.clear();
});
it("uses a marker when the displayed air-to-ground bracket has unknown height", () => {
  const entities = new EntityCollection();
  const viewer = {
    entities,
    scene: { primitives: { add: (p: unknown) => p, remove: () => true } },
    camera: { positionCartographic: { height: 1000 } },
  } as unknown as Viewer;
  const layer = new AircraftLayer(viewer, () => 1025),
    t = track([1010, 1020]);
  t.latest = {
    ...t.history[1],
    ground: true,
    alt_geom_m: null,
    alt_baro_m: null,
  };
  t.history[1] = t.latest;
  layer.update([t], t.id, true);
  expect(
    layer.entities.get(t.id)!.model!.show!.getValue(JulianDate.now()),
  ).toBe(false);
  layer.clear();
});

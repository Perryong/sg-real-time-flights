import { Cartesian3, Cartographic, Color, Ellipsoid, EllipsoidalOccluder, EntityCollection, HeightReference, JulianDate, Math as CMath, PerspectiveFrustum } from "cesium";
import { expect, it } from "vitest";
import type { JourneyPoint } from "../journey/types";
import { drawJourney, fitJourneyCamera, journeyPosition, markJourneyPoint } from "./journey";

const point = (time: number, lon: number, altitude_ft: number | null, estimated = false): JourneyPoint => ({
  time, lon, altitude_ft, estimated, lat: 4,
});
const now = JulianDate.now();

it("fits across the date line and contains observations far from Singapore", () => {
  const points = [point(0, 172, 24000), point(100, -171, 37000)];
  const frustum = new PerspectiveFrustum({ aspectRatio: 1.5, fov: Math.PI / 3 });
  const camera = fitJourneyCamera(points, { left: 0, right: 1, top: 0, bottom: 1 }, frustum)!;
  const location = Cartographic.fromCartesian(camera.destination);
  expect(Math.abs(CMath.toDegrees(location.longitude))).toBeGreaterThan(175);
  expect(location.height).toBeLessThan(3_000_000);
  const globe = new EllipsoidalOccluder(Ellipsoid.WGS84, camera.destination);
  expect(points.every(observation => globe.isPointVisible(journeyPosition(observation)))).toBe(true);
});

it("frames elevated and surface observations above a mobile drawer", () => {
  const points = [point(0, 160, 45000), { ...point(60, -169, 0), lat: 28 }];
  const viewport = { left: 0.05, right: 0.81, top: 0.18, bottom: 0.49 };
  const frustum = new PerspectiveFrustum({ aspectRatio: 0.45, fov: Math.PI / 3 });
  const camera = fitJourneyCamera(points, viewport, frustum)!;
  const { up, direction } = camera.orientation;
  const right = Cartesian3.cross(direction, up, new Cartesian3());
  for (const observation of points) {
    const relative = Cartesian3.subtract(journeyPosition(observation), camera.destination, new Cartesian3());
    const radius = Cartesian3.dot(relative, direction) * Math.tan(frustum.fovy! / 2);
    const x = 0.5 + Cartesian3.dot(relative, right) / (2 * radius * frustum.aspectRatio!);
    const y = 0.5 - Cartesian3.dot(relative, up) / (2 * radius);
    expect(x).toBeGreaterThan(0.05);
    expect(x).toBeLessThan(0.81);
    expect(y).toBeGreaterThan(0.18);
    expect(y).toBeLessThan(0.49);
  }
});

it("gives a single elevated observation room around its marker", () => {
  const observation = point(0, 144, 45000);
  const frustum = new PerspectiveFrustum({ aspectRatio: 1.5, fov: Math.PI / 3 });
  const camera = fitJourneyCamera([observation], { left: 0, right: 1, top: 0, bottom: 1 }, frustum)!;
  expect(Cartesian3.distance(camera.destination, journeyPosition(observation))).toBeGreaterThan(15000);
  expect(Cartographic.fromCartesian(camera.destination).longitude).toBeCloseTo(CMath.toRadians(144), 6);
});

it("keeps the ends of a long polar journey in front of the globe", () => {
  const points = [
    { ...point(0, 104, 0), lat: 1.36 },
    { ...point(3000, 107, 37000), lat: 55 },
    { ...point(4800, 110, 37000), lat: 83 },
    { ...point(5200, -78, 37000), lat: 82 },
    { ...point(7800, -77, 37000), lat: 54 },
    { ...point(9000, -74, 0), lat: 40.7 },
  ];
  const frustum = new PerspectiveFrustum({ aspectRatio: 1.7, fov: Math.PI / 3 });
  const camera = fitJourneyCamera(points, { left: 0.26, right: 0.69, top: 0.17, bottom: 0.9 }, frustum)!;
  const globe = new EllipsoidalOccluder(Ellipsoid.WGS84, camera.destination);
  expect(points.every(observation => globe.isPointVisible(journeyPosition(observation)))).toBe(true);
});

it("breaks the observed trail at estimates and gaps over 15 minutes", () => {
  const entities = new EntityCollection();
  drawJourney(entities, [
    point(0, 100, 0), point(900, 105, 10000), point(950, 108, 15000, true),
    point(1000, 110, 20000), point(1901, 120, 30000), point(2000, 121, 33000),
  ]);
  const lines = entities.values.flatMap(entity => entity.polyline?.positions?.getValue(now) ?? []);
  expect(lines.map(p => CMath.toDegrees(Cartographic.fromCartesian(p).longitude))).toEqual([
    expect.closeTo(100), expect.closeTo(105), expect.closeTo(120), expect.closeTo(121),
  ]);
  expect(Cartographic.fromCartesian(lines[0]).height).toBeCloseTo(0);
  expect(Cartographic.fromCartesian(lines[1]).height).toBeCloseTo(3048);
  const isolated = entities.values.filter(entity => entity.point);
  expect(isolated).toHaveLength(2);
  expect(isolated[0].point?.color?.getValue(now)).not.toEqual(isolated[1].point?.color?.getValue(now));
});

it("shows a geographic projection and a hollow point when altitude is unknown", () => {
  const entities = new EntityCollection();
  drawJourney(entities, [point(0, 100, 10000), point(60, 101, null), point(120, 102, 15000)]);
  const lines = entities.values.filter(entity => entity.polyline);
  expect(lines).toHaveLength(1);
  expect(lines[0].polyline?.clampToGround?.getValue(now)).toBe(true);
  expect(lines[0].polyline?.positions?.getValue(now)).toHaveLength(3);
  const markers = entities.values.filter(entity => entity.point);
  expect(markers).toHaveLength(1);
  expect(markers[0].point?.heightReference?.getValue(now)).toBe(HeightReference.CLAMP_TO_GROUND);
  expect(markers[0].point?.color?.getValue(now)).toEqual(Color.TRANSPARENT);
});

it("keeps a provider coverage restart visible even when the gap is short", () => {
  const entities = new EntityCollection();
  drawJourney(entities, [point(0, 100, 10000), { ...point(120, 101, 12000), gapBefore: true }]);
  expect(entities.values.filter(entity => entity.polyline)).toHaveLength(0);
  expect(entities.values.filter(entity => entity.point)).toHaveLength(2);
});

it("moves the selected marker to the new observation and removes it on clear", () => {
  const entities = new EntityCollection();
  markJourneyPoint(entities, point(10, 140, 27000));
  expect(Cartographic.fromCartesian(entities.values[0].position!.getValue(now)!).longitude).toBeCloseTo(CMath.toRadians(140));
  markJourneyPoint(entities, point(15, 165, 0));
  expect(entities.values).toHaveLength(1);
  const selected = entities.values[0];
  expect(Cartographic.fromCartesian(selected.position!.getValue(now)!).longitude).toBeCloseTo(CMath.toRadians(165));
  expect(Cartographic.fromCartesian(selected.position!.getValue(now)!).height).toBeCloseTo(0);
  expect(selected.point?.heightReference?.getValue(now)).toBe(HeightReference.NONE);
  markJourneyPoint(entities, undefined);
  expect(entities.values).toHaveLength(0);
});

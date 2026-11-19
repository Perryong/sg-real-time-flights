import { COVERAGE_RADIUS_NM } from "../data/coverage";
import {
  Cartesian3,
  Color,
  PolygonHierarchy,
  LabelStyle,
  Cartesian2,
  NearFarScalar,
  DistanceDisplayCondition,
  Viewer,
} from "cesium";
import type { Airport } from "../data/types";
export function addAirport(viewer: Viewer, airport: Airport) {
  const entities = [];
  for (const f of airport.runways.features) {
    const p = f.properties,
      coords = f.geometry.coordinates as number[][];
    entities.push(
      viewer.entities.add({
        id: `runway-${p.id}`,
        name: p.name,
        polyline: {
          positions: coords.map((c) => Cartesian3.fromDegrees(c[0], c[1], 3)),
          width: 14,
          material: Color.fromCssColorString("#62747e"),
        },
      }),
    );
    for (const th of p.thresholds) {
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(
            th.coordinate[0],
            th.coordinate[1],
            5,
          ),
          point: { pixelSize: 5, color: Color.fromCssColorString("#d5f99b") },
          label: {
            text: th.id,
            font: "600 11px sans-serif",
            fillColor: Color.fromCssColorString("#d5f99b"),
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            pixelOffset: new Cartesian2(0, 16),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 70000),
          },
        }),
      );
    }
  }
  for (const f of airport.taxiways.features) {
    entities.push(
      viewer.entities.add({
        id: f.properties.id,
        polyline: {
          positions: f.geometry.coordinates.map((c: number[]) =>
            Cartesian3.fromDegrees(c[0], c[1], 2),
          ),
          width: 2,
          material: Color.fromCssColorString("#497b78").withAlpha(0.65),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 40000),
        },
      }),
    );
  }
  for (const f of airport.buildings.features) {
    const ring = f.geometry.coordinates[0] as number[][];
    entities.push(
      viewer.entities.add({
        id: f.properties.id,
        name: f.properties.name,
        polygon: {
          hierarchy: new PolygonHierarchy(
            ring.map((c) => Cartesian3.fromDegrees(c[0], c[1])),
          ),
          height: 2,
          extrudedHeight: f.properties.height_m + 2,
          material: Color.fromCssColorString("#577882").withAlpha(0.85),
          outline: true,
          outlineColor: Color.fromCssColorString("#94c5c3"),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 65000),
        },
      }),
    );
  }
  const centre = Cartesian3.fromDegrees(103.9915, 1.3644, 30);
  entities.push(
    viewer.entities.add({
      id: "changi-label",
      position: centre,
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString("#c5f686"),
        outlineColor: Color.fromCssColorString("#5e824c"),
        outlineWidth: 5,
      },
      label: {
        text: "SINGAPORE CHANGI\nSIN / WSSS",
        font: "600 13px sans-serif",
        fillColor: Color.fromCssColorString("#d5f99b"),
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.fromCssColorString("#09141c"),
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, 32),
        scaleByDistance: new NearFarScalar(5000, 0.8, 150000, 1),
      },
    }),
  );
  const ring = Array.from({ length: 129 }, (_, i) => {
    const a = (i / 128) * Math.PI * 2;
    return Cartesian3.fromDegrees(
      103.9915 + Math.cos(a) * (COVERAGE_RADIUS_NM / 60) / Math.cos(1.3644 * Math.PI / 180),
      1.3644 + Math.sin(a) * (COVERAGE_RADIUS_NM / 60),
      20,
    );
  });
  entities.push(
    viewer.entities.add({
      id: "coverage",
      polyline: {
        positions: ring,
        width: 1,
        material: Color.fromCssColorString("#76a79a").withAlpha(0.3),
      },
    }),
  );
  return entities;
}

import {
  BoundingSphere, Cartesian3, Color, Ellipsoid, HeightReference, Matrix4,
  PolylineDashMaterialProperty, Transforms, type EntityCollection, type PerspectiveFrustum,
} from "cesium";
import { journeySegmentBreak, type JourneyPoint } from "../journey/types";

const measured = Color.fromCssColorString("#c3ed90");
const estimated = Color.fromCssColorString("#eac277");
const unknownAltitude = Color.fromCssColorString("#9ab5c1");
const markerId = "selected-journey-observation";

export interface MapViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function fitAxis(positions: Cartesian3[], axis: "x" | "y", first: number, last: number, tangent: number) {
  const padding = (last - first) * 0.08;
  const low = (2 * (first + padding) - 1) * tangent;
  const high = (2 * (last - padding) - 1) * tangent;
  let minimum = Infinity, maximum = -Infinity;
  for (const point of positions) {
    // At camera distance d, the two projected edges shift by d times their ray slopes.
    minimum = Math.min(minimum, point[axis] + point.z * low);
    maximum = Math.max(maximum, point[axis] + point.z * high);
  }
  return {
    distance: (maximum - minimum) / (high - low),
    center: (d: number) => (maximum + minimum - d * (low + high)) / 2,
  };
}

export function fitJourneyCamera(points: JourneyPoint[], viewport: MapViewport, frustum: PerspectiveFrustum) {
  const { fovy, aspectRatio } = frustum;
  if (!points.length || !fovy || !aspectRatio) return undefined;
  const positions = points.map(journeyPosition);
  const center = Ellipsoid.WGS84.scaleToGeodeticSurface(BoundingSphere.fromPoints(positions).center)
    ?? Ellipsoid.WGS84.scaleToGeodeticSurface(positions[0])!;
  const localToWorld = Transforms.eastNorthUpToFixedFrame(center);
  const worldToLocal = Matrix4.inverseTransformation(localToWorld, new Matrix4());
  for (const position of positions) Matrix4.multiplyByPoint(worldToLocal, position, position);
  const verticalTangent = Math.tan(fovy / 2);
  const horizontal = fitAxis(positions, "x", viewport.left, viewport.right, verticalTangent * aspectRatio);
  const vertical = fitAxis(positions, "y", 1 - viewport.bottom, 1 - viewport.top, verticalTangent);
  const distance = positions.reduce((distance, point) => Math.max(distance, point.z + 16000),
    Math.max(horizontal.distance, vertical.distance));
  const localCamera = new Cartesian3(horizontal.center(distance), vertical.center(distance), distance);
  const destination = Matrix4.multiplyByPoint(localToWorld, localCamera, new Cartesian3());
  const destinationFrame = Transforms.eastNorthUpToFixedFrame(destination);
  const routeToDestination = Matrix4.multiplyTransformation(
    Matrix4.inverseTransformation(destinationFrame, new Matrix4()), localToWorld, new Matrix4(),
  );
  // flyTo discards the bearing of a near-vertical direction. Give it explicit camera angles
  // relative to east, north and up at the destination.
  const down = Matrix4.multiplyByPointAsVector(routeToDestination, new Cartesian3(0, 0, -1), new Cartesian3());
  const north = Matrix4.multiplyByPointAsVector(routeToDestination, Cartesian3.UNIT_Y, new Cartesian3());
  const east = Matrix4.multiplyByPointAsVector(routeToDestination, Cartesian3.UNIT_X, new Cartesian3());
  const horizontalDirection = Math.hypot(down.x, down.y);
  const orientation = horizontalDirection < 1e-12
    ? { heading: Math.atan2(north.x, north.y), pitch: -Math.PI / 2, roll: 0 }
    : {
      heading: Math.atan2(down.x, down.y),
      pitch: Math.atan2(down.z, horizontalDirection),
      roll: Math.atan2(-east.z, north.z),
    };
  return { destination, orientation };
}

export function journeyPosition(point: JourneyPoint) {
  return Cartesian3.fromDegrees(point.lon, point.lat, (point.altitude_ft ?? 0) * 0.3048);
}

function marker(point: JourneyPoint, selected: boolean) {
  const unknown = point.altitude_ft === null;
  const color = point.estimated ? estimated : unknown ? unknownAltitude : measured;
  return {
    pixelSize: selected ? 15 : 7,
    color: unknown ? Color.TRANSPARENT : color,
    outlineColor: selected ? Color.WHITE : unknown ? color : Color.BLACK,
    outlineWidth: selected ? 3 : 2,
    heightReference: unknown ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
  };
}

export function drawJourney(entities: EntityCollection, points: JourneyPoint[]) {
  entities.suspendEvents();
  try {
    entities.removeAll();
    const paths: { projected: boolean; positions: Cartesian3[] }[] = [];
    let path: (typeof paths)[number] | undefined;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const next = points[i + 1];
      const connected = next && !journeySegmentBreak(point, next);
      if ((!path && !connected) || point.altitude_ft === null) {
        entities.add({ position: journeyPosition(point), point: marker(point, false) });
      }
      if (!connected) {
        path = undefined;
        continue;
      }
      const projected = point.altitude_ft === null || next.altitude_ft === null;
      if (!path || path.projected !== projected) {
        path = { projected, positions: [journeyPosition(point)] };
        paths.push(path);
      }
      path.positions.push(journeyPosition(next));
    }
    for (const { projected, positions } of paths) {
      entities.add({
        polyline: {
          positions,
          clampToGround: projected,
          width: projected ? 3 : 4,
          material: projected ? new PolylineDashMaterialProperty({ color: unknownAltitude, dashLength: 12 }) : measured,
        },
      });
    }
  } finally {
    entities.resumeEvents();
  }
}

export function markJourneyPoint(entities: EntityCollection, point: JourneyPoint | undefined) {
  entities.removeById(markerId);
  if (point) entities.add({ id: markerId, position: journeyPosition(point), point: marker(point, true) });
}

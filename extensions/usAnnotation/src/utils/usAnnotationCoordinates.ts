import type { CoordinateSpace, Point3D } from './usAnnotationJson';

function rasToLps([x, y, z]: Point3D): Point3D {
  return [-x, -y, z];
}

/**
 * Converts Slicer JSON line points to Cornerstone world coordinates (LPS mm).
 */
export function slicerPointsToWorld(
  points: Point3D[],
  coordinateSpace: CoordinateSpace
): [Point3D, Point3D] {
  const toLps = (point: Point3D): Point3D =>
    coordinateSpace === 'RAS' ? rasToLps(point) : point;

  return [toLps(points[0]), toLps(points[1])];
}

/**
 * Converts a Cornerstone world point (LPS mm) to a Slicer JSON point.
 */
export function worldPointToSlicerLps(worldPoint: number[]): Point3D {
  const [x, y, z = 0] = worldPoint;
  return [x, y, z];
}

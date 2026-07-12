/**
 * Three.js SphereGeometry maps texture-space longitude +X to mesh-local -X.
 * The procedural climate generator defines texture-space +X as the
 * substellar point. Therefore mesh-local -X is the visual sun-facing axis.
 */
export function yawForSubstellarMeshAxis(directionX: number, directionZ: number) {
  return Math.atan2(directionZ, -directionX)
}

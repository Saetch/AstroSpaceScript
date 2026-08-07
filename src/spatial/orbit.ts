import type { Moon, Planet, StarSystem, Vector3Tuple } from '../domain/universe'

/**
 * Canonical parent-local orbit definition shared with the SpacetimeDB module.
 *
 * Coordinate convention:
 * - +Y is the reference-plane normal.
 * - The unrotated ellipse lies in X/Z.
 * - All angles are radians.
 * - `semiMajorAxis` and returned positions use the parent's local units.
 * - `phaseAtEpoch` is the eccentric-anomaly-like path parameter at simulation t=0.
 *   This intentionally gives simple deterministic motion rather than physical Kepler timing.
 */
export interface OrbitDefinition {
  semiMajorAxis: number
  eccentricity: number
  inclination: number
  longitudeOfAscendingNode: number
  argumentOfPeriapsis: number
  phaseAtEpoch: number
  angularSpeed: number
}

export interface SpatialNode {
  id: string
  parentId?: string
  /** Static parent-local offset, in the parent's local units. */
  localPosition?: Vector3Tuple
  /** Optional parent-local trajectory. Added to `localPosition` when present. */
  orbit?: OrbitDefinition
}

const TAU = Math.PI * 2

export function normalizeRadians(value: number): number {
  const normalized = value % TAU
  return normalized < 0 ? normalized + TAU : normalized
}

export function orbitPhaseAtTime(orbit: OrbitDefinition, simulationTimeSeconds: number): number {
  return normalizeRadians(orbit.phaseAtEpoch + orbit.angularSpeed * simulationTimeSeconds)
}

/** Evaluate a parent-local position using the exact same operation order as the Rust backend. */
export function orbitPositionAtPhase(
  orbit: OrbitDefinition,
  phase: number,
  renderScale = 1,
): Vector3Tuple {
  const eccentricity = Math.min(Math.max(orbit.eccentricity, 0), 0.95)
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, 0) * renderScale
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity)

  // Ellipse with the parent at one focus.
  const x = semiMajorAxis * (Math.cos(phase) - eccentricity)
  const z = semiMinorAxis * Math.sin(phase)

  // 1) Rotate periapsis inside the orbital plane, around +Y.
  const cosArgument = Math.cos(orbit.argumentOfPeriapsis)
  const sinArgument = Math.sin(orbit.argumentOfPeriapsis)
  const argumentX = cosArgument * x + sinArgument * z
  const argumentZ = -sinArgument * x + cosArgument * z

  // 2) Tilt the plane around +X.
  const cosInclination = Math.cos(orbit.inclination)
  const sinInclination = Math.sin(orbit.inclination)
  const tiltedX = argumentX
  const tiltedY = -sinInclination * argumentZ
  const tiltedZ = cosInclination * argumentZ

  // 3) Rotate the line of nodes around the parent's +Y axis.
  const cosLongitude = Math.cos(orbit.longitudeOfAscendingNode)
  const sinLongitude = Math.sin(orbit.longitudeOfAscendingNode)

  return [
    cosLongitude * tiltedX + sinLongitude * tiltedZ,
    tiltedY,
    -sinLongitude * tiltedX + cosLongitude * tiltedZ,
  ]
}

export function orbitPositionAtTime(
  orbit: OrbitDefinition,
  simulationTimeSeconds: number,
  renderScale = 1,
): Vector3Tuple {
  return orbitPositionAtPhase(orbit, orbitPhaseAtTime(orbit, simulationTimeSeconds), renderScale)
}

export function sampleOrbit(
  orbit: OrbitDefinition,
  segments = 128,
  renderScale = 1,
): Vector3Tuple[] {
  const safeSegments = Math.max(8, Math.floor(segments))
  return Array.from({ length: safeSegments + 1 }, (_, index) =>
    orbitPositionAtPhase(orbit, (index / safeSegments) * TAU, renderScale),
  )
}

export function resolveSpatialNodePosition(
  nodes: ReadonlyMap<string, SpatialNode>,
  nodeId: string,
  simulationTimeSeconds: number,
): Vector3Tuple {
  const visiting = new Set<string>()

  function resolve(id: string): Vector3Tuple {
    if (visiting.has(id)) throw new Error(`Spatial node cycle detected at ${id}`)
    const node = nodes.get(id)
    if (!node) throw new Error(`Unknown spatial node: ${id}`)

    visiting.add(id)
    const staticPosition = node.localPosition ?? [0, 0, 0]
    const orbitPosition = node.orbit
      ? orbitPositionAtTime(node.orbit, simulationTimeSeconds)
      : [0, 0, 0] as Vector3Tuple
    const local: Vector3Tuple = [
      staticPosition[0] + orbitPosition[0],
      staticPosition[1] + orbitPosition[1],
      staticPosition[2] + orbitPosition[2],
    ]

    const result = node.parentId
      ? (() => {
          const parent = resolve(node.parentId!)
          return [parent[0] + local[0], parent[1] + local[1], parent[2] + local[2]] as Vector3Tuple
        })()
      : local

    visiting.delete(id)
    return result
  }

  return resolve(nodeId)
}

export function planetOrbitDefinition(planet: Planet): OrbitDefinition {
  return {
    semiMajorAxis: planet.orbitRadius,
    eccentricity: planet.orbitEccentricity ?? 0,
    inclination: planet.orbitInclination ?? 0,
    longitudeOfAscendingNode: planet.orbitLongitude ?? 0,
    argumentOfPeriapsis: planet.orbitArgument ?? 0,
    phaseAtEpoch: planet.orbitOffset,
    angularSpeed: planet.orbitSpeed,
  }
}

export function moonOrbitDefinition(moon: Moon): OrbitDefinition {
  // Keep this evaluator compatible with projects whose generated Moon type
  // predates the optional eccentricity/ascending-node columns.
  const orbitMoon = moon as Moon & {
    orbitEccentricity?: number
    orbitLongitude?: number
  }

  return {
    semiMajorAxis: moon.orbitRadius,
    eccentricity: orbitMoon.orbitEccentricity ?? 0,
    inclination: moon.orbitInclination ?? 0,
    longitudeOfAscendingNode: orbitMoon.orbitLongitude ?? 0,
    argumentOfPeriapsis: moon.orbitArgument ?? 0,
    phaseAtEpoch: moon.orbitOffset,
    angularSpeed: moon.orbitSpeed,
  }
}


/** Build the current system/planet/moon data into the generic spatial-node graph. */
export function buildSystemSpatialNodes(system: StarSystem): Map<string, SpatialNode> {
  const nodes = new Map<string, SpatialNode>()
  nodes.set(system.id, {
    id: system.id,
    localPosition: [0, 0, 0],
  })

  for (const planet of system.planets) {
    nodes.set(planet.id, {
      id: planet.id,
      parentId: system.id,
      orbit: planetOrbitDefinition(planet),
    })

    for (const moon of planet.moons ?? []) {
      nodes.set(moon.id, {
        id: moon.id,
        parentId: planet.id,
        orbit: moonOrbitDefinition(moon),
      })
    }
  }

  return nodes
}

import type { Planet, StarSystem, Vector3Tuple } from '../domain/universe'

const TAU = Math.PI * 2
const EPSILON = 1e-7
const REFERENCE_PROGRADE_SPEED_MPS = 30_000
const SYSTEM_GRAVITATIONAL_PARAMETER_PER_SOLAR_MASS = 0.451_584

export interface SpacecraftOrbit {
  semiMajorAxis: number
  eccentricity: number
  /** Unit vector pointing from the focus toward periapsis. */
  periapsisAxis: Vector3Tuple
  /** Unit vector 90 degrees prograde from periapsis in the orbital plane. */
  transverseAxis: Vector3Tuple
  /** True-anomaly-like phase at simulation t=0. */
  phaseAtEpoch: number
  /** Radians per simulation second. */
  angularSpeed: number
}

export interface ManeuverDeltaV {
  prograde: number
  radial: number
  normal: number
}

export interface ManeuverDraft {
  /** True anomaly around the current orbit where the impulse is planned. */
  burnPhase: number
  deltaV: ManeuverDeltaV
}

export interface ClientSpacecraftPlan {
  id: string
  name: string
  parentId: string
  /** Planet this local prototype was launched from. */
  launchPlanetId?: string
  launchPlanetName?: string
  orbit: SpacecraftOrbit
  maneuver: ManeuverDraft
}

export type ManeuverAxis = keyof ManeuverDeltaV

export interface ManeuverBasis {
  prograde: Vector3Tuple
  radial: Vector3Tuple
  normal: Vector3Tuple
}

export interface ManeuverPreview {
  orbit: SpacecraftOrbit
  burnPosition: Vector3Tuple
  burnVelocity: Vector3Tuple
  deltaVMagnitude: number
  valid: boolean
  warning?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function normalizeAngle(value: number): number {
  const normalized = value % TAU
  return normalized < 0 ? normalized + TAU : normalized
}

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function multiply(vector: Vector3Tuple, scalar: number): Vector3Tuple {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar]
}

function dot(a: Vector3Tuple, b: Vector3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function magnitude(vector: Vector3Tuple): number {
  return Math.sqrt(dot(vector, vector))
}

function normalize(vector: Vector3Tuple, fallback: Vector3Tuple = [1, 0, 0]): Vector3Tuple {
  const length = magnitude(vector)
  return length > EPSILON ? multiply(vector, 1 / length) : fallback
}

function rotateAroundY(vector: Vector3Tuple, angle: number): Vector3Tuple {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    cos * vector[0] + sin * vector[2],
    vector[1],
    -sin * vector[0] + cos * vector[2],
  ]
}

function rotateAroundX(vector: Vector3Tuple, angle: number): Vector3Tuple {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    vector[0],
    cos * vector[1] - sin * vector[2],
    sin * vector[1] + cos * vector[2],
  ]
}

function axesFromAngles(
  inclination: number,
  longitudeOfAscendingNode: number,
  argumentOfPeriapsis: number,
): { periapsisAxis: Vector3Tuple; transverseAxis: Vector3Tuple } {
  const transform = (vector: Vector3Tuple) => {
    const periapsisRotated = rotateAroundY(vector, argumentOfPeriapsis)
    // Match the existing system convention: positive inclination tilts +Z toward -Y.
    const tilted = rotateAroundX(periapsisRotated, -inclination)
    return normalize(rotateAroundY(tilted, longitudeOfAscendingNode))
  }

  return {
    periapsisAxis: transform([1, 0, 0]),
    transverseAxis: transform([0, 0, 1]),
  }
}

export function systemGravitationalParameter(primaryMassSolar: number): number {
  return SYSTEM_GRAVITATIONAL_PARAMETER_PER_SOLAR_MASS * Math.max(primaryMassSolar, 0.01)
}

function eccentricToTrueAnomaly(eccentricAnomaly: number, eccentricity: number): number {
  const e = clamp(eccentricity, 0, 0.95)
  return normalizeAngle(Math.atan2(
    Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly),
    Math.cos(eccentricAnomaly) - e,
  ))
}

/**
 * Create a local spacecraft exactly at a planet's current heliocentric position.
 *
 * Planet trajectories use the shared scene-graph orbit convention (uniform eccentric
 * anomaly). The maneuver prototype uses a true-anomaly conic, so we convert the
 * planet's current phase once at launch. From then on the spacecraft is its own node.
 */
export function createSpacecraftPlanFromPlanet(
  system: StarSystem,
  planet: Planet,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  const eccentricity = clamp(planet.orbitEccentricity ?? 0, 0, 0.95)
  const semiMajorAxis = Math.max(planet.orbitRadius, EPSILON)
  const currentPlanetPhase = normalizeAngle(
    planet.orbitOffset + planet.orbitSpeed * simulationTimeSeconds,
  )
  const currentTrueAnomaly = eccentricToTrueAnomaly(currentPlanetPhase, eccentricity)
  const { periapsisAxis, transverseAxis } = axesFromAngles(
    planet.orbitInclination ?? 0,
    planet.orbitLongitude ?? 0,
    planet.orbitArgument ?? 0,
  )
  const mu = systemGravitationalParameter(system.primaryMassSolar ?? 1)
  const angularSpeed = Math.sqrt(mu / Math.pow(semiMajorAxis, 3))

  return {
    id: `local-ship:${system.id}:${planet.id}`,
    name: `${planet.name} Pathfinder`,
    parentId: system.id,
    launchPlanetId: planet.id,
    launchPlanetName: planet.name,
    orbit: {
      semiMajorAxis,
      eccentricity,
      periapsisAxis,
      transverseAxis,
      phaseAtEpoch: normalizeAngle(currentTrueAnomaly - angularSpeed * simulationTimeSeconds),
      angularSpeed,
    },
    maneuver: {
      // Put the initial maneuver node exactly at the launch point.
      burnPhase: currentTrueAnomaly,
      deltaV: { prograde: 0, radial: 0, normal: 0 },
    },
  }
}

export function spacecraftPositionAtPhase(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  renderScale = 1,
): Vector3Tuple {
  const eccentricity = clamp(orbit.eccentricity, 0, 0.97)
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, EPSILON)
  const semiLatusRectum = semiMajorAxis * (1 - eccentricity * eccentricity)
  const radius = semiLatusRectum / Math.max(1 + eccentricity * Math.cos(trueAnomaly), EPSILON)
  const localX = radius * Math.cos(trueAnomaly) * renderScale
  const localY = radius * Math.sin(trueAnomaly) * renderScale

  return add(
    multiply(orbit.periapsisAxis, localX),
    multiply(orbit.transverseAxis, localY),
  )
}

export function spacecraftPhaseAtTime(orbit: SpacecraftOrbit, simulationTimeSeconds: number): number {
  return normalizeAngle(orbit.phaseAtEpoch + orbit.angularSpeed * simulationTimeSeconds)
}

export function spacecraftPositionAtTime(
  orbit: SpacecraftOrbit,
  simulationTimeSeconds: number,
  renderScale = 1,
): Vector3Tuple {
  return spacecraftPositionAtPhase(
    orbit,
    spacecraftPhaseAtTime(orbit, simulationTimeSeconds),
    renderScale,
  )
}

export function sampleSpacecraftOrbit(
  orbit: SpacecraftOrbit,
  segments = 160,
  renderScale = 1,
): Vector3Tuple[] {
  const safeSegments = Math.max(24, Math.floor(segments))
  return Array.from({ length: safeSegments + 1 }, (_, index) =>
    spacecraftPositionAtPhase(orbit, (index / safeSegments) * TAU, renderScale),
  )
}

function stateAtPhase(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  mu: number,
): { position: Vector3Tuple; velocity: Vector3Tuple } {
  const eccentricity = clamp(orbit.eccentricity, 0, 0.97)
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, EPSILON)
  const p = semiMajorAxis * (1 - eccentricity * eccentricity)
  const radius = p / Math.max(1 + eccentricity * Math.cos(trueAnomaly), EPSILON)
  const velocityScale = Math.sqrt(mu / Math.max(p, EPSILON))

  const position = add(
    multiply(orbit.periapsisAxis, radius * Math.cos(trueAnomaly)),
    multiply(orbit.transverseAxis, radius * Math.sin(trueAnomaly)),
  )
  const velocity = add(
    multiply(orbit.periapsisAxis, -Math.sin(trueAnomaly) * velocityScale),
    multiply(orbit.transverseAxis, (eccentricity + Math.cos(trueAnomaly)) * velocityScale),
  )

  return { position, velocity }
}

export function spacecraftManeuverBasis(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  primaryMassSolar: number,
): ManeuverBasis {
  const state = stateAtPhase(orbit, normalizeAngle(trueAnomaly), systemGravitationalParameter(primaryMassSolar))
  return {
    radial: normalize(state.position),
    prograde: normalize(state.velocity),
    normal: normalize(cross(state.position, state.velocity), [0, -1, 0]),
  }
}

function orbitFromState(
  position: Vector3Tuple,
  velocity: Vector3Tuple,
  mu: number,
  phaseAtEpoch: number,
): SpacecraftOrbit | undefined {
  const radius = magnitude(position)
  const speedSquared = dot(velocity, velocity)
  if (radius <= EPSILON || mu <= EPSILON) return undefined

  const angularMomentum = cross(position, velocity)
  const hMagnitude = magnitude(angularMomentum)
  if (hMagnitude <= EPSILON) return undefined

  const eccentricityVector = subtract(
    multiply(cross(velocity, angularMomentum), 1 / mu),
    multiply(position, 1 / radius),
  )
  const eccentricity = magnitude(eccentricityVector)
  const specificEnergy = speedSquared / 2 - mu / radius

  // This prototype renders closed Kepler ellipses only. The shared flight library can
  // later extend the exact same planner contract to parabolic/hyperbolic trajectories.
  if (specificEnergy >= -EPSILON || eccentricity >= 0.97) return undefined

  const semiMajorAxis = -mu / (2 * specificEnergy)
  if (!Number.isFinite(semiMajorAxis) || semiMajorAxis <= EPSILON) return undefined

  const periapsisAxis = eccentricity > 1e-4
    ? normalize(eccentricityVector)
    : normalize(position)
  const orbitalNormal = normalize(angularMomentum, [0, -1, 0])
  const transverseAxis = normalize(cross(orbitalNormal, periapsisAxis), [0, 0, 1])
  const angularSpeed = Math.sqrt(mu / Math.pow(semiMajorAxis, 3))

  return {
    semiMajorAxis,
    eccentricity,
    periapsisAxis,
    transverseAxis,
    phaseAtEpoch,
    angularSpeed,
  }
}

/**
 * Frontend-only maneuver preview adapter.
 *
 * The React UI and scene depend on this function, not on its implementation. When the
 * shared Rust -> TypeScript flight library lands, replace this function with the library
 * call and keep the rest of the planner unchanged.
 *
 * Until then, displayed m/s are mapped relative to the spacecraft's local orbital speed:
 * 30 km/s of requested delta-v equals one current orbital-speed magnitude.
 */
export function previewManeuver(
  plan: ClientSpacecraftPlan,
  primaryMassSolar: number,
): ManeuverPreview {
  const mu = systemGravitationalParameter(primaryMassSolar)
  const burnPhase = normalizeAngle(plan.maneuver.burnPhase)
  const state = stateAtPhase(plan.orbit, burnPhase, mu)
  const speed = Math.max(magnitude(state.velocity), EPSILON)
  const basis = spacecraftManeuverBasis(plan.orbit, burnPhase, primaryMassSolar)
  const velocityUnitsPerMps = speed / REFERENCE_PROGRADE_SPEED_MPS

  const deltaVelocity = add(
    add(
      multiply(basis.prograde, plan.maneuver.deltaV.prograde * velocityUnitsPerMps),
      multiply(basis.radial, plan.maneuver.deltaV.radial * velocityUnitsPerMps),
    ),
    multiply(basis.normal, plan.maneuver.deltaV.normal * velocityUnitsPerMps),
  )
  const nextVelocity = add(state.velocity, deltaVelocity)
  const provisional = orbitFromState(
    state.position,
    nextVelocity,
    mu,
    plan.orbit.phaseAtEpoch,
  )
  const deltaVMagnitude = Math.sqrt(
    plan.maneuver.deltaV.prograde ** 2
      + plan.maneuver.deltaV.radial ** 2
      + plan.maneuver.deltaV.normal ** 2,
  )

  if (deltaVMagnitude < 0.001) {
    return {
      orbit: plan.orbit,
      burnPosition: state.position,
      burnVelocity: state.velocity,
      deltaVMagnitude: 0,
      valid: true,
    }
  }

  if (!provisional) {
    return {
      orbit: plan.orbit,
      burnPosition: state.position,
      burnVelocity: state.velocity,
      deltaVMagnitude,
      valid: false,
      warning: 'Preview leaves the closed-orbit envelope. Escape trajectories will be handled by the shared flight library.',
    }
  }

  // Re-phase the preview so adopting it at the current simulation time can remain
  // position-continuous. The actual phase-at-epoch is finalized by commitManeuverPreview.
  const previewPhase = normalizeAngle(Math.atan2(
    dot(state.position, provisional.transverseAxis),
    dot(state.position, provisional.periapsisAxis),
  ))

  return {
    orbit: { ...provisional, phaseAtEpoch: previewPhase },
    burnPosition: state.position,
    burnVelocity: nextVelocity,
    deltaVMagnitude,
    valid: true,
  }
}

export function commitManeuverPreview(
  plan: ClientSpacecraftPlan,
  preview: ManeuverPreview,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  if (!preview.valid) return plan

  const burnPhaseOnNewOrbit = normalizeAngle(Math.atan2(
    dot(preview.burnPosition, preview.orbit.transverseAxis),
    dot(preview.burnPosition, preview.orbit.periapsisAxis),
  ))

  return {
    ...plan,
    orbit: {
      ...preview.orbit,
      phaseAtEpoch: normalizeAngle(
        burnPhaseOnNewOrbit - preview.orbit.angularSpeed * simulationTimeSeconds,
      ),
    },
    maneuver: {
      burnPhase: burnPhaseOnNewOrbit,
      deltaV: { prograde: 0, radial: 0, normal: 0 },
    },
  }
}

export function spacecraftInclinationDegrees(orbit: SpacecraftOrbit): number {
  const normal = normalize(cross(orbit.periapsisAxis, orbit.transverseAxis), [0, -1, 0])
  // Existing system orbits advance +X toward +Z, whose reference normal is -Y.
  return Math.acos(clamp(dot(normal, [0, -1, 0]), -1, 1)) * 180 / Math.PI
}

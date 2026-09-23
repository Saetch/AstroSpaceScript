import type { Planet, StarSystem, Vector3Tuple } from "../domain/universe";
import {
  bodySystemPositionAtTime,
  bodySystemVelocityAtTime,
  buildFlightBodies,
  deepestInfluenceBodyAtPosition,
  distanceBetween,
  findFlightBody,
  starFlightMu,
  transferTargetsForPrimary,
  type FlightBody,
  type FlightBodyKind,
} from "./flightInfluence";

const TAU = Math.PI * 2;
const EPSILON = 1e-7;
const REFERENCE_PROGRADE_SPEED_MPS = 6_000;
const RUNTIME_EVENT_EPSILON_SECONDS = 1e-5;

export interface SpacecraftOrbit {
  semiMajorAxis: number;
  eccentricity: number;
  /** Unit vector pointing from the focus toward periapsis. */
  periapsisAxis: Vector3Tuple;
  /** Unit vector 90 degrees prograde from periapsis in the orbital plane. */
  transverseAxis: Vector3Tuple;
  /** True-anomaly-like phase at simulation t=0. */
  phaseAtEpoch: number;
  /** Radians per simulation second. Deliberately game-scaled, not SI Kepler timing. */
  angularSpeed: number;
}

export interface ManeuverDeltaV {
  prograde: number;
  radial: number;
  normal: number;
}

export interface ManeuverDraft {
  /** Local true-anomaly-like point where the impulse will execute. */
  burnPhase: number;
  /** Number of complete additional revolutions before using this phase crossing. */
  orbitPass: number;
  deltaV: ManeuverDeltaV;
}

export interface PlannedManeuverNode {
  id: string;
  sequence: number;
  primaryBodyId: string;
  primaryBodyName: string;
  burnPhase: number;
  orbitPass: number;
  executeAtSimulationTime: number;
  deltaV: ManeuverDeltaV;
  deltaVMagnitude: number;
  orbitBefore: SpacecraftOrbit;
  orbitAfter: SpacecraftOrbit;
}

export type SpacecraftFlightState = "landed" | "orbiting" | "destroyed";

export interface InfluenceTransitionRecord {
  fromBodyId: string;
  fromBodyName: string;
  toBodyId: string;
  toBodyName: string;
  atSimulationTime: number;
}

export interface SurfaceImpactRecord {
  bodyId: string;
  bodyName: string;
  atSimulationTime: number;
}

export interface SpacecraftSurfaceAnchor {
  label: string;
  latitude: number;
  longitude: number;
  pointId?: string;
}

export interface ClientSpacecraftPlan {
  id: string;
  name: string;
  systemId: string;
  flightState: SpacecraftFlightState;
  /** Body whose local frame currently owns the spacecraft trajectory. */
  primaryBodyId: string;
  primaryBodyName: string;
  primaryBodyKind: FlightBodyKind;
  launchPlanetId: string;
  launchPlanetName: string;
  /** Exact surface site where the craft is parked before takeoff. */
  launchSurface: SpacecraftSurfaceAnchor;
  orbit: SpacecraftOrbit;
  maneuver: ManeuverDraft;
  /** Immutable future impulses, ordered by execution time. */
  maneuverQueue: PlannedManeuverNode[];
  transitionSerial: number;
  lastInfluenceTransition?: InfluenceTransitionRecord;
  lastManeuverExecutedAt?: number;
  lastSurfaceImpact?: SurfaceImpactRecord;
  /** Simulation cursor used by the pure runtime event scheduler. */
  lastAdvancedSimulationTime: number;
  /** Optional next patched-conic frame the player is trying to intercept. */
  transferTargetBodyId?: string;
}

export type ManeuverAxis = keyof ManeuverDeltaV;

export interface ManeuverBasis {
  prograde: Vector3Tuple;
  radial: Vector3Tuple;
  normal: Vector3Tuple;
}

export interface ManeuverPreview {
  orbit: SpacecraftOrbit;
  burnPosition: Vector3Tuple;
  burnVelocity: Vector3Tuple;
  deltaVMagnitude: number;
  valid: boolean;
  warning?: string;
}

export interface InfluencePrediction {
  fromBodyId: string;
  fromBodyName: string;
  toBodyId: string;
  toBodyName: string;
  toBodyKind: FlightBodyKind;
  eventKind: "entry" | "exit";
  atSimulationTime: number;
  secondsFromNow: number;
  orbitsFromNow: number;
  /** Future system-space point where the SOI boundary is crossed. */
  atSystemPosition: Vector3Tuple;
  /** Center/radius of the SOI boundary at the predicted crossing time. */
  boundaryCenterSystemPosition: Vector3Tuple;
  boundaryRadius: number;
  /** The first orbit after reparenting into the destination frame. */
  destinationOrbit: SpacecraftOrbit;
}

export interface TransferTargetPrediction {
  targetBodyId: string;
  targetBodyName: string;
  targetBodyKind: FlightBodyKind;
  eventKind: "entry" | "exit";
  willTransition: boolean;
  atSimulationTime: number;
  secondsFromNow: number;
  orbitsFromNow: number;
  boundaryRadius: number;
  boundaryGap: number;
  spacecraftSystemPosition: Vector3Tuple;
  boundaryCenterSystemPosition: Vector3Tuple;
  /** Another SOI is reached first, so this target cannot be planned in the current frame yet. */
  blockedByBodyName?: string;
  blockedAtSimulationTime?: number;
}

export interface FlightForecast {
  nextTransition?: InfluencePrediction;
  targetApproach?: TransferTargetPrediction;
  searchedOrbits: number;
}

export const MAX_TRANSFER_SEARCH_ORBITS = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeAngle(value: number): number {
  const normalized = value % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(vector: Vector3Tuple, scalar: number): Vector3Tuple {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function dot(a: Vector3Tuple, b: Vector3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(vector: Vector3Tuple): number {
  return Math.sqrt(dot(vector, vector));
}

function normalize(
  vector: Vector3Tuple,
  fallback: Vector3Tuple = [1, 0, 0],
): Vector3Tuple {
  const length = magnitude(vector);
  return length > EPSILON ? multiply(vector, 1 / length) : fallback;
}

function rotateAroundY(vector: Vector3Tuple, angle: number): Vector3Tuple {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    cos * vector[0] + sin * vector[2],
    vector[1],
    -sin * vector[0] + cos * vector[2],
  ];
}

function rotateAroundX(vector: Vector3Tuple, angle: number): Vector3Tuple {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    vector[0],
    cos * vector[1] - sin * vector[2],
    sin * vector[1] + cos * vector[2],
  ];
}

function axesFromAngles(
  inclination: number,
  longitudeOfAscendingNode: number,
  argumentOfPeriapsis: number,
): { periapsisAxis: Vector3Tuple; transverseAxis: Vector3Tuple } {
  const transform = (vector: Vector3Tuple) => {
    const periapsisRotated = rotateAroundY(vector, argumentOfPeriapsis);
    const tilted = rotateAroundX(periapsisRotated, -inclination);
    return normalize(rotateAroundY(tilted, longitudeOfAscendingNode));
  };

  return {
    periapsisAxis: transform([1, 0, 0]),
    transverseAxis: transform([0, 0, 1]),
  };
}

/** Backwards-compatible helper for callers that only have a stellar mass. */
export function systemGravitationalParameter(primaryMassSolar: number): number {
  return 0.451_584 * Math.max(primaryMassSolar, 0.01);
}

function gameAngularSpeed(mu: number, semiMajorAxis: number): number {
  // Travel is intentionally compressed for gameplay. Large transfer arcs should take
  // minutes, not real orbital periods, while small local orbits can still feel quick.
  return clamp(
    Math.sqrt(
      Math.max(mu, EPSILON) / Math.pow(Math.max(semiMajorAxis, EPSILON), 3),
    ),
    0.012,
    0.65,
  );
}

function takeoffOrbitForPlanet(
  planet: Planet,
  planetMu: number,
  simulationTimeSeconds: number,
): SpacecraftOrbit {
  const semiMajorAxis = Math.max(planet.radius * 1.16, planet.radius + 0.08);
  const eccentricity = 0.025;
  const { periapsisAxis, transverseAxis } = axesFromAngles(
    planet.orbitInclination ?? 0,
    planet.orbitLongitude ?? 0,
    planet.orbitArgument ?? 0,
  );
  const angularSpeed = gameAngularSpeed(planetMu, semiMajorAxis);
  const currentPhase = 0;
  return {
    semiMajorAxis,
    eccentricity,
    periapsisAxis,
    transverseAxis,
    phaseAtEpoch: normalizeAngle(
      currentPhase - angularSpeed * simulationTimeSeconds,
    ),
    angularSpeed,
  };
}

function launchSurfaceForPlanet(planet: Planet): SpacecraftSurfaceAnchor {
  const settlement = planet.surfacePoints.find(
    (point) => point.kind === "settlement",
  );
  if (settlement) {
    return {
      label: settlement.label,
      latitude: settlement.latitude,
      longitude: settlement.longitude,
      pointId: settlement.id,
    };
  }

  // Live SpacetimeDB planet rows do not expose surface points yet. Keep a stable
  // fallback spaceport on the actual surface rather than inventing an orbital spawn.
  return {
    label: `${planet.name} Surface Spaceport`,
    latitude: 18,
    longitude: -28,
  };
}

/** Prepare a ship on the surface. It does not have flight motion until takeoff. */
export function createLandedSpacecraftPlan(
  system: StarSystem,
  planet: Planet,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  const planetBody = findFlightBody(system, planet.id);
  const mu = planetBody?.gravitationalParameter ?? 0.02;
  const orbit = takeoffOrbitForPlanet(planet, mu, simulationTimeSeconds);
  const plan: ClientSpacecraftPlan = {
    id: `local-ship:${system.id}:${planet.id}`,
    name: `${planet.name} Pathfinder`,
    systemId: system.id,
    flightState: "landed",
    primaryBodyId: planet.id,
    primaryBodyName: planet.name,
    primaryBodyKind: "planet",
    launchPlanetId: planet.id,
    launchPlanetName: planet.name,
    launchSurface: launchSurfaceForPlanet(planet),
    orbit,
    maneuver: {
      burnPhase: normalizeAngle(
        spacecraftPhaseAtTime(orbit, simulationTimeSeconds) + 0.9,
      ),
      orbitPass: 0,
      deltaV: { prograde: 0, radial: 0, normal: 0 },
    },
    maneuverQueue: [],
    transitionSerial: 0,
    lastAdvancedSimulationTime: simulationTimeSeconds,
    transferTargetBodyId: system.id,
  };
  return plan;
}

/** Create the first low orbit. This is the actual transition from surface to flight. */
export function takeOffSpacecraft(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  planet: Planet,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  const planetBody = findFlightBody(system, planet.id);
  const mu = planetBody?.gravitationalParameter ?? 0.02;
  const orbit = takeoffOrbitForPlanet(planet, mu, simulationTimeSeconds);
  const phase = spacecraftPhaseAtTime(orbit, simulationTimeSeconds);
  const next: ClientSpacecraftPlan = {
    ...plan,
    flightState: "orbiting",
    primaryBodyId: planet.id,
    primaryBodyName: planet.name,
    primaryBodyKind: "planet",
    orbit,
    maneuver: {
      burnPhase: normalizeAngle(phase + 0.95),
      orbitPass: 0,
      deltaV: { prograde: 0, radial: 0, normal: 0 },
    },
    maneuverQueue: [],
    lastAdvancedSimulationTime: simulationTimeSeconds,
    transferTargetBodyId: system.id,
  };
  return next;
}

/** Legacy name retained so older local code still compiles; now prepares a landed ship. */
export const createSpacecraftPlanFromPlanet = createLandedSpacecraftPlan;

export function spacecraftPositionAtPhase(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  renderScale = 1,
): Vector3Tuple {
  const eccentricity = clamp(orbit.eccentricity, 0, 0.9995);
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, EPSILON);
  const semiLatusRectum = semiMajorAxis * (1 - eccentricity * eccentricity);
  const radius =
    semiLatusRectum /
    Math.max(1 + eccentricity * Math.cos(trueAnomaly), EPSILON);
  const localX = radius * Math.cos(trueAnomaly) * renderScale;
  const localY = radius * Math.sin(trueAnomaly) * renderScale;

  return add(
    multiply(orbit.periapsisAxis, localX),
    multiply(orbit.transverseAxis, localY),
  );
}

export function spacecraftPhaseAtTime(
  orbit: SpacecraftOrbit,
  simulationTimeSeconds: number,
): number {
  return normalizeAngle(
    orbit.phaseAtEpoch + orbit.angularSpeed * simulationTimeSeconds,
  );
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
  );
}

export function spacecraftVelocityAtTime(
  orbit: SpacecraftOrbit,
  simulationTimeSeconds: number,
  gravitationalParameter: number,
): Vector3Tuple {
  return stateAtTime(orbit, simulationTimeSeconds, gravitationalParameter)
    .velocity;
}

export function sampleSpacecraftOrbit(
  orbit: SpacecraftOrbit,
  segments = 160,
  renderScale = 1,
): Vector3Tuple[] {
  const safeSegments = Math.max(24, Math.floor(segments));
  return Array.from({ length: safeSegments + 1 }, (_, index) =>
    spacecraftPositionAtPhase(orbit, (index / safeSegments) * TAU, renderScale),
  );
}

export function spacecraftPeriapsisRadius(orbit: SpacecraftOrbit): number {
  return (
    Math.max(orbit.semiMajorAxis, EPSILON) *
    (1 - clamp(orbit.eccentricity, 0, 0.9995))
  );
}

export function spacecraftApoapsisRadius(orbit: SpacecraftOrbit): number {
  return (
    Math.max(orbit.semiMajorAxis, EPSILON) *
    (1 + clamp(orbit.eccentricity, 0, 0.9995))
  );
}

function stateAtPhase(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  mu: number,
): { position: Vector3Tuple; velocity: Vector3Tuple } {
  const eccentricity = clamp(orbit.eccentricity, 0, 0.9995);
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, EPSILON);
  const p = semiMajorAxis * (1 - eccentricity * eccentricity);
  const radius =
    p / Math.max(1 + eccentricity * Math.cos(trueAnomaly), EPSILON);
  const velocityScale = Math.sqrt(Math.max(mu, EPSILON) / Math.max(p, EPSILON));

  const position = add(
    multiply(orbit.periapsisAxis, radius * Math.cos(trueAnomaly)),
    multiply(orbit.transverseAxis, radius * Math.sin(trueAnomaly)),
  );
  const velocity = add(
    multiply(orbit.periapsisAxis, -Math.sin(trueAnomaly) * velocityScale),
    multiply(
      orbit.transverseAxis,
      (eccentricity + Math.cos(trueAnomaly)) * velocityScale,
    ),
  );

  return { position, velocity };
}

function stateAtTime(
  orbit: SpacecraftOrbit,
  simulationTimeSeconds: number,
  mu: number,
): { position: Vector3Tuple; velocity: Vector3Tuple } {
  return stateAtPhase(
    orbit,
    spacecraftPhaseAtTime(orbit, simulationTimeSeconds),
    mu,
  );
}

export function spacecraftManeuverBasis(
  orbit: SpacecraftOrbit,
  trueAnomaly: number,
  gravitationalParameter: number,
): ManeuverBasis {
  const state = stateAtPhase(
    orbit,
    normalizeAngle(trueAnomaly),
    gravitationalParameter,
  );
  return {
    radial: normalize(state.position),
    prograde: normalize(state.velocity),
    normal: normalize(cross(state.position, state.velocity), [0, -1, 0]),
  };
}

export function planningOrbitForPlan(
  plan: ClientSpacecraftPlan,
): SpacecraftOrbit {
  const queue = plan.maneuverQueue ?? [];
  return queue.length > 0 ? queue[queue.length - 1].orbitAfter : plan.orbit;
}

export function planningAnchorTime(
  plan: ClientSpacecraftPlan,
  simulationTimeSeconds: number,
): number {
  const queue = plan.maneuverQueue ?? [];
  return queue.length > 0
    ? Math.max(
        simulationTimeSeconds,
        queue[queue.length - 1].executeAtSimulationTime,
      )
    : simulationTimeSeconds;
}

export function draftManeuverExecutionTime(
  plan: ClientSpacecraftPlan,
  simulationTimeSeconds: number,
): number {
  const orbit = planningOrbitForPlan(plan);
  const anchorTime = planningAnchorTime(plan, simulationTimeSeconds);
  const currentPhase = spacecraftPhaseAtTime(orbit, anchorTime);
  let deltaPhase = normalizeAngle(plan.maneuver.burnPhase - currentPhase);
  // A node directly under the planning cursor means the next crossing, never now.
  if (deltaPhase < 0.035) deltaPhase += TAU;
  const additionalRevolutions = Math.max(
    0,
    Math.floor(plan.maneuver.orbitPass ?? 0),
  );
  deltaPhase += additionalRevolutions * TAU;
  return anchorTime + deltaPhase / Math.max(orbit.angularSpeed, EPSILON);
}

/**
 * Convert a local position/velocity state into the game's closed conic representation.
 * If the incoming state is formally unbound, we deliberately project it to a very
 * eccentric closed path. The influence boundary will hand the craft to the parent body
 * before the fake far side of that ellipse matters.
 */
function gameOrbitFromState(
  position: Vector3Tuple,
  velocity: Vector3Tuple,
  mu: number,
  simulationTimeSeconds: number,
): SpacecraftOrbit {
  const radius = Math.max(magnitude(position), EPSILON);
  const radialAxis = normalize(position);
  let orbitalNormal = normalize(cross(position, velocity), [0, -1, 0]);
  let tangentialVelocity = subtract(
    velocity,
    multiply(radialAxis, dot(velocity, radialAxis)),
  );
  if (magnitude(tangentialVelocity) <= EPSILON) {
    tangentialVelocity = cross(orbitalNormal, radialAxis);
    if (magnitude(tangentialVelocity) <= EPSILON) {
      orbitalNormal = normalize(cross(radialAxis, [0, 1, 0]), [0, 0, 1]);
      tangentialVelocity = cross(orbitalNormal, radialAxis);
    }
  }
  const tangentAxis = normalize(tangentialVelocity, [0, 0, 1]);
  const radialSpeed = dot(velocity, radialAxis);
  const tangentialSpeed = Math.max(dot(velocity, tangentAxis), EPSILON);
  const radialToTangential = radialSpeed / tangentialSpeed;

  // The game uses deliberately compressed orbital timing. Fit a closed ellipse to
  // the *kinematic* state rather than treating generated orbit units as SI. This
  // preserves the direction through an SOI handoff and keeps prograde/retrograde
  // burns intuitive without requiring real Kepler periods.
  const circularGameSpeed = Math.max(
    radius * gameAngularSpeed(mu, radius),
    EPSILON,
  );
  const speedRatio = magnitude(velocity) / circularGameSpeed;
  // Deliberately stronger than a physical energy->eccentricity mapping: the game
  // keeps transfer times short, so a few km/s of UI delta-v must be able to lift a
  // low orbit all the way to a gameplay SOI boundary.
  const speedEccentricity = 1 - Math.exp(-Math.abs(speedRatio - 1) * 1.15);
  const minimumDirectionalEccentricity =
    Math.abs(radialToTangential) /
    Math.sqrt(1 + radialToTangential * radialToTangential);
  const eccentricity = clamp(
    Math.max(0.01, speedEccentricity, minimumDirectionalEccentricity + 0.002),
    0.01,
    0.9995,
  );

  const q = radialToTangential;
  const sineArgument = clamp(
    q / Math.max(eccentricity * Math.sqrt(1 + q * q), EPSILON),
    -1,
    1,
  );
  const baseAngle = Math.atan(q);
  const branchAngle = Math.asin(sineArgument);
  const firstCandidate = normalizeAngle(baseAngle + branchAngle);
  const secondCandidate = normalizeAngle(baseAngle + Math.PI - branchAngle);
  const trueAnomaly =
    speedRatio >= 1
      ? Math.cos(firstCandidate) >= Math.cos(secondCandidate)
        ? firstCandidate
        : secondCandidate
      : Math.cos(firstCandidate) <= Math.cos(secondCandidate)
        ? firstCandidate
        : secondCandidate;

  const cosF = Math.cos(trueAnomaly);
  const sinF = Math.sin(trueAnomaly);
  const periapsisAxis = normalize(
    add(multiply(radialAxis, cosF), multiply(tangentAxis, -sinF)),
  );
  let transverseAxis = normalize(
    add(multiply(radialAxis, sinF), multiply(tangentAxis, cosF)),
  );
  if (dot(cross(periapsisAxis, transverseAxis), orbitalNormal) < 0) {
    transverseAxis = multiply(transverseAxis, -1);
  }

  const semiMajorAxis = Math.max(
    (radius * (1 + eccentricity * cosF)) /
      Math.max(1 - eccentricity * eccentricity, 0.02),
    radius * 0.52,
  );
  const angularSpeed = clamp(tangentialSpeed / radius, 0.001, 1.5);

  return {
    semiMajorAxis,
    eccentricity,
    periapsisAxis,
    transverseAxis,
    phaseAtEpoch: normalizeAngle(
      trueAnomaly - angularSpeed * simulationTimeSeconds,
    ),
    angularSpeed,
  };
}

export function previewManeuver(
  plan: ClientSpacecraftPlan,
  gravitationalParameter: number,
  minimumSafeRadius = 0,
): ManeuverPreview {
  const sourceOrbit = planningOrbitForPlan(plan);
  const burnPhase = normalizeAngle(plan.maneuver.burnPhase);
  const state = stateAtPhase(sourceOrbit, burnPhase, gravitationalParameter);
  const speed = Math.max(magnitude(state.velocity), EPSILON);
  const basis = spacecraftManeuverBasis(
    sourceOrbit,
    burnPhase,
    gravitationalParameter,
  );
  const velocityUnitsPerMps = speed / REFERENCE_PROGRADE_SPEED_MPS;

  const deltaVelocity = add(
    add(
      multiply(
        basis.prograde,
        plan.maneuver.deltaV.prograde * velocityUnitsPerMps,
      ),
      multiply(basis.radial, plan.maneuver.deltaV.radial * velocityUnitsPerMps),
    ),
    multiply(basis.normal, plan.maneuver.deltaV.normal * velocityUnitsPerMps),
  );
  const nextVelocity = add(state.velocity, deltaVelocity);
  const nextOrbit = gameOrbitFromState(
    state.position,
    nextVelocity,
    gravitationalParameter,
    0,
  );
  const deltaVMagnitude = Math.sqrt(
    plan.maneuver.deltaV.prograde ** 2 +
      plan.maneuver.deltaV.radial ** 2 +
      plan.maneuver.deltaV.normal ** 2,
  );

  const previewPhase = normalizeAngle(
    Math.atan2(
      dot(state.position, nextOrbit.transverseAxis),
      dot(state.position, nextOrbit.periapsisAxis),
    ),
  );

  const resolvedOrbit = { ...nextOrbit, phaseAtEpoch: previewPhase };
  const periapsisRadius = spacecraftPeriapsisRadius(resolvedOrbit);
  const intersectsSurface =
    minimumSafeRadius > 0 && periapsisRadius < minimumSafeRadius;

  return {
    orbit: resolvedOrbit,
    burnPosition: state.position,
    burnVelocity: nextVelocity,
    deltaVMagnitude,
    valid: !intersectsSurface,
    warning: intersectsSurface
      ? `Trajectory intersects the body: periapsis ${periapsisRadius.toFixed(3)} u is below the ${minimumSafeRadius.toFixed(3)} u surface-clearance radius.`
      : nextOrbit.eccentricity > 0.9
        ? "This is an escape-like transfer. A primary-body handoff should occur before the artificial far side of this game ellipse."
        : undefined,
  };
}

export function commitManeuverPreview(
  plan: ClientSpacecraftPlan,
  preview: ManeuverPreview,
  executionSimulationTime: number,
): ClientSpacecraftPlan {
  if (!preview.valid) return plan;

  return {
    ...plan,
    orbit: orbitFromPreviewAtExecutionTime(preview, executionSimulationTime),
    lastManeuverExecutedAt: executionSimulationTime,
  };
}

function orbitFromPreviewAtExecutionTime(
  preview: ManeuverPreview,
  executionSimulationTime: number,
): SpacecraftOrbit {
  const burnPhaseOnNewOrbit = normalizeAngle(
    Math.atan2(
      dot(preview.burnPosition, preview.orbit.transverseAxis),
      dot(preview.burnPosition, preview.orbit.periapsisAxis),
    ),
  );

  return {
    ...preview.orbit,
    phaseAtEpoch: normalizeAngle(
      burnPhaseOnNewOrbit -
        preview.orbit.angularSpeed * executionSimulationTime,
    ),
  };
}

function resetDraftForOrbit(
  orbit: SpacecraftOrbit,
  simulationTimeSeconds: number,
): ManeuverDraft {
  return {
    burnPhase: normalizeAngle(
      spacecraftPhaseAtTime(orbit, simulationTimeSeconds) + 0.9,
    ),
    orbitPass: 0,
    deltaV: { prograde: 0, radial: 0, normal: 0 },
  };
}

export function scheduleManeuver(
  plan: ClientSpacecraftPlan,
  simulationTimeSeconds: number,
  gravitationalParameter?: number,
  minimumSafeRadius = 0,
): ClientSpacecraftPlan {
  if (plan.flightState !== "orbiting") return plan;
  const mu = gravitationalParameter;
  if (mu === undefined) return plan;
  const preview = previewManeuver(plan, mu, minimumSafeRadius);
  if (!preview.valid || preview.deltaVMagnitude < 0.01) return plan;

  const executionSimulationTime = draftManeuverExecutionTime(
    plan,
    simulationTimeSeconds,
  );
  const orbitBefore = planningOrbitForPlan(plan);
  const orbitAfter = orbitFromPreviewAtExecutionTime(
    preview,
    executionSimulationTime,
  );
  const queue = plan.maneuverQueue ?? [];
  const node: PlannedManeuverNode = {
    id: `${plan.id}:node:${plan.transitionSerial}:${queue.length}:${Math.round(executionSimulationTime * 1000)}`,
    sequence: queue.length + 1,
    primaryBodyId: plan.primaryBodyId,
    primaryBodyName: plan.primaryBodyName,
    burnPhase: normalizeAngle(plan.maneuver.burnPhase),
    orbitPass: Math.max(0, Math.floor(plan.maneuver.orbitPass ?? 0)),
    executeAtSimulationTime: executionSimulationTime,
    deltaV: { ...plan.maneuver.deltaV },
    deltaVMagnitude: preview.deltaVMagnitude,
    orbitBefore,
    orbitAfter,
  };

  return {
    ...plan,
    maneuverQueue: [...queue, node],
    maneuver: resetDraftForOrbit(orbitAfter, executionSimulationTime),
  };
}

export function removePlannedManeuverAndFollowing(
  plan: ClientSpacecraftPlan,
  nodeId: string,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  const queue = plan.maneuverQueue ?? [];
  const index = queue.findIndex((node) => node.id === nodeId);
  if (index < 0) return plan;
  const nextQueue = queue.slice(0, index);
  const tailOrbit = nextQueue.length
    ? nextQueue[nextQueue.length - 1].orbitAfter
    : plan.orbit;
  const anchor = nextQueue.length
    ? nextQueue[nextQueue.length - 1].executeAtSimulationTime
    : simulationTimeSeconds;
  return {
    ...plan,
    maneuverQueue: nextQueue,
    maneuver: resetDraftForOrbit(
      tailOrbit,
      Math.max(anchor, simulationTimeSeconds),
    ),
  };
}

export function clearPlannedManeuvers(
  plan: ClientSpacecraftPlan,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  if ((plan.maneuverQueue ?? []).length === 0) return plan;
  return {
    ...plan,
    maneuverQueue: [],
    maneuver: resetDraftForOrbit(plan.orbit, simulationTimeSeconds),
  };
}

/** Backwards-compatible name. Clearing a scheduled maneuver now clears the queue. */
export function clearScheduledManeuver(
  plan: ClientSpacecraftPlan,
): ClientSpacecraftPlan {
  return {
    ...plan,
    maneuverQueue: [],
  };
}

function spacecraftSystemPositionRaw(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
): Vector3Tuple {
  const body =
    findFlightBody(system, plan.primaryBodyId) ?? buildFlightBodies(system)[0];
  const localPosition = spacecraftPositionAtTime(
    plan.orbit,
    simulationTimeSeconds,
  );
  const bodyPosition = bodySystemPositionAtTime(
    system,
    body.id,
    simulationTimeSeconds,
  );
  return add(bodyPosition, localPosition);
}

export function spacecraftSystemStateAtTime(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
): { position: Vector3Tuple; velocity: Vector3Tuple } {
  const dt = 0.01;
  const position = spacecraftSystemPositionRaw(
    plan,
    system,
    simulationTimeSeconds,
  );
  const before = spacecraftSystemPositionRaw(
    plan,
    system,
    simulationTimeSeconds - dt,
  );
  const after = spacecraftSystemPositionRaw(
    plan,
    system,
    simulationTimeSeconds + dt,
  );
  return {
    position,
    velocity: multiply(subtract(after, before), 1 / (2 * dt)),
  };
}

export function spacecraftSystemPositionAtTime(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
): Vector3Tuple {
  return spacecraftSystemPositionRaw(plan, system, simulationTimeSeconds);
}

function selectedInfluenceBodyForShip(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  position: Vector3Tuple,
  simulationTimeSeconds: number,
): FlightBody {
  const current =
    findFlightBody(system, plan.primaryBodyId) ?? buildFlightBodies(system)[0];
  const deepest = deepestInfluenceBodyAtPosition(
    system,
    position,
    simulationTimeSeconds,
  );

  if (current.kind === "star") return deepest;

  const currentCenter = bodySystemPositionAtTime(
    system,
    current.id,
    simulationTimeSeconds,
  );
  const withinCurrent =
    distanceBetween(position, currentCenter) <= current.influenceRadius * 1.025;

  // A moon is a deeper frame than its planet and should win as soon as the craft enters it.
  if (deepest.kind === "moon" && deepest.id !== current.id) return deepest;
  if (
    current.kind === "planet" &&
    deepest.kind === "planet" &&
    deepest.id !== current.id
  )
    return deepest;
  if (withinCurrent) return current;
  return deepest;
}

function reparentSpacecraft(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  nextBody: FlightBody,
  simulationTimeSeconds: number,
  transition?: InfluencePrediction,
): ClientSpacecraftPlan {
  const state = spacecraftSystemStateAtTime(
    plan,
    system,
    simulationTimeSeconds,
  );
  const orbit =
    transition?.toBodyId === nextBody.id
      ? transition.destinationOrbit
      : (() => {
          const nextBodyPosition = bodySystemPositionAtTime(
            system,
            nextBody.id,
            simulationTimeSeconds,
          );
          const nextBodyVelocity = bodySystemVelocityAtTime(
            system,
            nextBody.id,
            simulationTimeSeconds,
          );
          const localPosition = subtract(state.position, nextBodyPosition);
          const localVelocity = subtract(state.velocity, nextBodyVelocity);
          return gameOrbitFromState(
            localPosition,
            localVelocity,
            nextBody.gravitationalParameter,
            simulationTimeSeconds,
          );
        })();
  const phase = spacecraftPhaseAtTime(orbit, simulationTimeSeconds);

  return {
    ...plan,
    primaryBodyId: nextBody.id,
    primaryBodyName: nextBody.name,
    primaryBodyKind: nextBody.kind,
    orbit,
    maneuver: {
      burnPhase: normalizeAngle(phase + 0.85),
      orbitPass: 0,
      deltaV: { prograde: 0, radial: 0, normal: 0 },
    },
    maneuverQueue: [],
    transitionSerial: plan.transitionSerial + 1,
    transferTargetBodyId: undefined,
    lastInfluenceTransition: {
      fromBodyId: plan.primaryBodyId,
      fromBodyName: plan.primaryBodyName,
      toBodyId: nextBody.id,
      toBodyName: nextBody.name,
      atSimulationTime: simulationTimeSeconds,
    },
  };
}

function executePlannedNode(
  plan: ClientSpacecraftPlan,
  node: PlannedManeuverNode,
): ClientSpacecraftPlan {
  if (node.primaryBodyId !== plan.primaryBodyId) {
    return { ...plan, maneuverQueue: [] };
  }
  const queue = plan.maneuverQueue ?? [];
  return {
    ...plan,
    orbit: node.orbitAfter,
    maneuverQueue: queue.length > 0 ? queue.slice(1) : [],
    lastManeuverExecutedAt: node.executeAtSimulationTime,
  };
}

function nextSurfaceImpactTime(
  orbit: SpacecraftOrbit,
  surfaceRadius: number,
  fromSimulationTime: number,
  toSimulationTime: number,
): number | undefined {
  if (!(surfaceRadius > 0) || toSimulationTime < fromSimulationTime)
    return undefined;

  const currentRadius = magnitude(
    spacecraftPositionAtTime(orbit, fromSimulationTime),
  );
  if (currentRadius <= surfaceRadius + EPSILON) return fromSimulationTime;

  const eccentricity = clamp(orbit.eccentricity, 0, 0.9995);
  const semiMajorAxis = Math.max(orbit.semiMajorAxis, EPSILON);
  const periapsis = semiMajorAxis * (1 - eccentricity);
  if (periapsis > surfaceRadius + EPSILON || eccentricity <= EPSILON) {
    return undefined;
  }

  const apoapsis = semiMajorAxis * (1 + eccentricity);
  if (apoapsis <= surfaceRadius + EPSILON) return fromSimulationTime;

  const p = semiMajorAxis * (1 - eccentricity * eccentricity);
  const cosine = (p / Math.max(surfaceRadius, EPSILON) - 1) / eccentricity;
  if (cosine < -1 - 1e-6 || cosine > 1 + 1e-6) return undefined;

  // With increasing true anomaly, the 2π-acos branch is the inbound surface crossing.
  const inboundPhase = normalizeAngle(TAU - Math.acos(clamp(cosine, -1, 1)));
  const currentPhase = spacecraftPhaseAtTime(orbit, fromSimulationTime);
  let deltaPhase = normalizeAngle(inboundPhase - currentPhase);
  if (deltaPhase < 1e-8) deltaPhase = 0;
  const impactTime =
    fromSimulationTime + deltaPhase / Math.max(orbit.angularSpeed, EPSILON);
  return impactTime <= toSimulationTime + RUNTIME_EVENT_EPSILON_SECONDS
    ? impactTime
    : undefined;
}

function destroySpacecraftAtSurface(
  plan: ClientSpacecraftPlan,
  body: FlightBody,
  atSimulationTime: number,
): ClientSpacecraftPlan {
  return {
    ...plan,
    flightState: "destroyed",
    maneuverQueue: [],
    transferTargetBodyId: undefined,
    lastSurfaceImpact: {
      bodyId: body.id,
      bodyName: body.name,
      atSimulationTime,
    },
    lastAdvancedSimulationTime: atSimulationTime,
  };
}

/** Advance scheduled impulses and influence-zone handoffs. Safe to call several times per second. */
export function advanceSpacecraftPlan(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
): ClientSpacecraftPlan {
  if (plan.flightState !== "orbiting") return plan;

  // IMPORTANT: this function is deliberately pure. React may invoke state-updater
  // functions more than once in development/Strict Mode. A module-level runtime
  // cursor makes the first invocation consume an event and the second invocation
  // return the old plan, which is exactly how scheduled burns could be skipped.
  // Keeping the cursor in the immutable plan makes repeated calls deterministic.
  const storedCursor = Number.isFinite(plan.lastAdvancedSimulationTime)
    ? plan.lastAdvancedSimulationTime
    : simulationTimeSeconds;
  const previousAdvance = Math.min(storedCursor, simulationTimeSeconds);

  let next: ClientSpacecraftPlan = plan;
  let cursor = previousAdvance;

  // A node that is already due must still execute. This covers resumed tabs, clock
  // corrections and frames that land after the exact timestamp. Because orbitAfter
  // was frozen when the node was planned, executing it late does not recompute the
  // user's burn from a mutable draft.
  if (
    previousAdvance >=
    simulationTimeSeconds - RUNTIME_EVENT_EPSILON_SECONDS
  ) {
    let due = (next.maneuverQueue ?? [])[0];
    let guard = 0;
    while (
      due &&
      due.executeAtSimulationTime <=
        simulationTimeSeconds + RUNTIME_EVENT_EPSILON_SECONDS &&
      guard < 512
    ) {
      next = executePlannedNode(next, due);
      due = (next.maneuverQueue ?? [])[0];
      guard += 1;
    }

    const position = spacecraftSystemPositionAtTime(
      next,
      system,
      simulationTimeSeconds,
    );
    const selected = selectedInfluenceBodyForShip(
      next,
      system,
      position,
      simulationTimeSeconds,
    );
    if (selected.id !== next.primaryBodyId) {
      next = reparentSpacecraft(next, system, selected, simulationTimeSeconds);
    }
    return { ...next, lastAdvancedSimulationTime: simulationTimeSeconds };
  }

  // A long frame can contain both a scheduled impulse and an SOI handoff. Process
  // them chronologically so the burn never executes early and the frame handoff is
  // solved at the boundary rather than at the next React polling tick.
  for (
    let iteration = 0;
    iteration < 512 &&
    cursor < simulationTimeSeconds - RUNTIME_EVENT_EPSILON_SECONDS;
    iteration += 1
  ) {
    const primary =
      findFlightBody(system, next.primaryBodyId) ??
      buildFlightBodies(system)[0];
    const nextNode = (next.maneuverQueue ?? [])[0];
    const scheduledAt = nextNode?.executeAtSimulationTime;

    // If a previous UI/render tick happened to miss the exact timestamp, execute
    // the immutable node now rather than allowing the ship to circle forever.
    if (
      nextNode &&
      scheduledAt !== undefined &&
      scheduledAt <= cursor + RUNTIME_EVENT_EPSILON_SECONDS
    ) {
      next = executePlannedNode(next, nextNode);
      continue;
    }

    const burnWithinWindow =
      nextNode !== undefined &&
      scheduledAt !== undefined &&
      scheduledAt <= simulationTimeSeconds + RUNTIME_EVENT_EPSILON_SECONDS;
    const segmentEnd =
      burnWithinWindow && scheduledAt !== undefined
        ? Math.min(scheduledAt, simulationTimeSeconds)
        : simulationTimeSeconds;
    const transition = findEarliestRuntimeTransition(
      next,
      system,
      primary,
      cursor,
      segmentEnd,
    );
    const impactAt = nextSurfaceImpactTime(
      next.orbit,
      primary.bodyRadius,
      cursor,
      segmentEnd,
    );
    const impactBeforeTransition =
      impactAt !== undefined &&
      (!transition ||
        impactAt <=
          transition.atSimulationTime + RUNTIME_EVENT_EPSILON_SECONDS);
    const impactBeforeBurn =
      impactAt !== undefined &&
      (!burnWithinWindow ||
        impactAt < segmentEnd - RUNTIME_EVENT_EPSILON_SECONDS);

    if (impactBeforeTransition && impactBeforeBurn && impactAt !== undefined) {
      next = destroySpacecraftAtSurface(next, primary, impactAt);
      cursor = simulationTimeSeconds;
      break;
    }

    if (
      transition &&
      transition.atSimulationTime < segmentEnd - RUNTIME_EVENT_EPSILON_SECONDS
    ) {
      const destination = findFlightBody(system, transition.toBodyId);
      if (!destination) break;
      next = reparentSpacecraft(
        next,
        system,
        destination,
        transition.atSimulationTime,
        transition,
      );
      cursor = Math.min(
        simulationTimeSeconds,
        transition.atSimulationTime + RUNTIME_EVENT_EPSILON_SECONDS,
      );
      continue;
    }

    if (burnWithinWindow && nextNode && scheduledAt !== undefined) {
      next = executePlannedNode(next, nextNode);
      cursor = Math.min(
        simulationTimeSeconds,
        scheduledAt + RUNTIME_EVENT_EPSILON_SECONDS,
      );
      continue;
    }

    if (transition) {
      const destination = findFlightBody(system, transition.toBodyId);
      if (destination) {
        next = reparentSpacecraft(
          next,
          system,
          destination,
          transition.atSimulationTime,
          transition,
        );
      }
    }
    cursor = simulationTimeSeconds;
  }

  return next.lastAdvancedSimulationTime === simulationTimeSeconds
    ? next
    : { ...next, lastAdvancedSimulationTime: simulationTimeSeconds };
}

function maneuverDeltaVMagnitude(plan: ClientSpacecraftPlan): number {
  return Math.hypot(
    plan.maneuver.deltaV.prograde,
    plan.maneuver.deltaV.radial,
    plan.maneuver.deltaV.normal,
  );
}

interface PlannedOrbitSegment {
  orbit: SpacecraftOrbit;
  startsAt: number;
  nodeId?: string;
}

function plannedOrbitSegmentsForPrediction(
  plan: ClientSpacecraftPlan,
  primary: FlightBody,
  simulationTimeSeconds: number,
): PlannedOrbitSegment[] {
  const segments: PlannedOrbitSegment[] = [
    { orbit: plan.orbit, startsAt: Number.NEGATIVE_INFINITY },
  ];
  for (const node of plan.maneuverQueue ?? []) {
    if (node.primaryBodyId !== primary.id) break;
    segments.push({
      orbit: node.orbitAfter,
      startsAt: node.executeAtSimulationTime,
      nodeId: node.id,
    });
  }

  // The editable draft is included as the final hypothetical segment. This keeps
  // encounter previews live without changing the authoritative spacecraft state.
  if (maneuverDeltaVMagnitude(plan) >= 0.01) {
    const preview = previewManeuver(
      plan,
      primary.gravitationalParameter,
      primary.bodyRadius * 1.01,
    );
    if (preview.valid) {
      const executeAt = draftManeuverExecutionTime(plan, simulationTimeSeconds);
      segments.push({
        orbit: orbitFromPreviewAtExecutionTime(preview, executeAt),
        startsAt: executeAt,
      });
    }
  }

  return segments.sort((a, b) => a.startsAt - b.startsAt);
}

function orbitForPredictionAtTime(
  segments: PlannedOrbitSegment[],
  simulationTimeSeconds: number,
): SpacecraftOrbit {
  let selected = segments[0].orbit;
  for (const segment of segments) {
    if (
      segment.startsAt <=
      simulationTimeSeconds + RUNTIME_EVENT_EPSILON_SECONDS
    ) {
      selected = segment.orbit;
    } else {
      break;
    }
  }
  return selected;
}

function predictedSystemPositionAtTime(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  primary: FlightBody,
  simulationTimeSeconds: number,
  plannedSegments: PlannedOrbitSegment[],
): Vector3Tuple {
  const orbit = orbitForPredictionAtTime(
    plannedSegments,
    simulationTimeSeconds,
  );
  const local = spacecraftPositionAtTime(orbit, simulationTimeSeconds);
  return add(
    bodySystemPositionAtTime(system, primary.id, simulationTimeSeconds),
    local,
  );
}

function predictedSystemStateAtTime(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  primary: FlightBody,
  simulationTimeSeconds: number,
  plannedSegments: PlannedOrbitSegment[],
): { position: Vector3Tuple; velocity: Vector3Tuple } {
  const dt = 0.01;
  const position = predictedSystemPositionAtTime(
    plan,
    system,
    primary,
    simulationTimeSeconds,
    plannedSegments,
  );
  const before = predictedSystemPositionAtTime(
    plan,
    system,
    primary,
    simulationTimeSeconds - dt,
    plannedSegments,
  );
  const after = predictedSystemPositionAtTime(
    plan,
    system,
    primary,
    simulationTimeSeconds + dt,
    plannedSegments,
  );
  return {
    position,
    velocity: multiply(subtract(after, before), 1 / (2 * dt)),
  };
}

interface TransferBoundary {
  target: FlightBody;
  boundaryBody: FlightBody;
  eventKind: "entry" | "exit";
  radius: number;
}

function transferBoundaryForTarget(
  primary: FlightBody,
  target: FlightBody,
): TransferBoundary | undefined {
  if (primary.parentId === target.id) {
    return {
      target,
      boundaryBody: primary,
      eventKind: "exit",
      radius: primary.influenceRadius,
    };
  }
  if (target.parentId === primary.id) {
    return {
      target,
      boundaryBody: target,
      eventKind: "entry",
      radius: target.influenceRadius,
    };
  }
  return undefined;
}

function findBoundaryTransitionBetween(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  primary: FlightBody,
  boundary: TransferBoundary,
  startTime: number,
  endTime: number,
): InfluencePrediction | undefined {
  const duration = endTime - startTime;
  if (duration <= RUNTIME_EVENT_EPSILON_SECONDS) return undefined;

  const spacecraftPeriod = TAU / Math.max(plan.orbit.angularSpeed, 0.001);
  const boundaryPeriod = bodyMotionPeriodSeconds(system, boundary.boundaryBody);
  const shortestPeriod = Number.isFinite(boundaryPeriod)
    ? Math.min(spacecraftPeriod, boundaryPeriod)
    : spacecraftPeriod;
  // Normal updates are only ~0.1-0.2s, but this also remains reliable after a
  // throttled/background browser frame without doing an unbounded amount of work.
  const steps = Math.round(
    clamp(Math.ceil((duration / Math.max(shortestPeriod, 0.05)) * 96), 4, 2048),
  );

  const metricAt = (time: number) => {
    const state = spacecraftSystemStateAtTime(plan, system, time);
    return {
      state,
      ...boundaryMetric(system, boundary, state.position, time),
    };
  };

  const refine = (lowTime: number, highTime: number): InfluencePrediction => {
    let low = lowTime;
    let high = highTime;
    for (let iteration = 0; iteration < 28; iteration += 1) {
      const mid = (low + high) / 2;
      if (metricAt(mid).metric > 0) low = mid;
      else high = mid;
    }
    const crossingTime = high;
    const crossing = metricAt(crossingTime);
    return influencePredictionAtCrossing(
      system,
      primary,
      boundary,
      crossing.state,
      crossingTime,
      startTime,
      spacecraftPeriod,
    );
  };

  let previousTime = startTime;
  let previous = metricAt(previousTime);

  for (let index = 1; index <= steps; index += 1) {
    const currentTime = startTime + (duration * index) / steps;
    const current = metricAt(currentTime);

    // A burn can happen exactly on a boundary. In that case the next segment starts
    // at metric ~= 0; if motion immediately proceeds across the boundary, record the
    // handoff at the boundary timestamp instead of one polling tick later.
    if (Math.abs(previous.metric) <= 1e-6 && current.metric < -1e-6) {
      return influencePredictionAtCrossing(
        system,
        primary,
        boundary,
        previous.state,
        previousTime,
        startTime,
        spacecraftPeriod,
      );
    }

    if (previous.metric > 0 && current.metric <= 0) {
      return refine(previousTime, currentTime);
    }

    // A small moving SOI can be crossed completely between two samples. Test the
    // closest point of the relative-motion chord and refine the entry if needed.
    if (
      boundary.eventKind === "entry" &&
      previous.metric > 0 &&
      current.metric > 0
    ) {
      const fraction = segmentClosestFraction(
        previous.relative,
        current.relative,
      );
      if (fraction > 0.001 && fraction < 0.999) {
        const candidateTime =
          previousTime + (currentTime - previousTime) * fraction;
        const candidate = metricAt(candidateTime);
        if (candidate.metric <= 0) return refine(previousTime, candidateTime);
      }
    }

    previousTime = currentTime;
    previous = current;
  }

  return undefined;
}

function findEarliestRuntimeTransition(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  primary: FlightBody,
  startTime: number,
  endTime: number,
): InfluencePrediction | undefined {
  let earliest: InfluencePrediction | undefined;
  for (const target of transferTargetsForPrimary(system, primary.id)) {
    const boundary = transferBoundaryForTarget(primary, target);
    if (!boundary) continue;
    const transition = findBoundaryTransitionBetween(
      plan,
      system,
      primary,
      boundary,
      startTime,
      endTime,
    );
    if (
      transition &&
      (!earliest || transition.atSimulationTime < earliest.atSimulationTime)
    ) {
      earliest = transition;
    }
  }
  return earliest;
}

function bodyMotionPeriodSeconds(system: StarSystem, body: FlightBody): number {
  if (body.kind === "star") return Number.POSITIVE_INFINITY;
  if (body.kind === "planet") {
    const planet = system.planets.find((candidate) => candidate.id === body.id);
    return planet && Math.abs(planet.orbitSpeed) > EPSILON
      ? TAU / Math.abs(planet.orbitSpeed)
      : Number.POSITIVE_INFINITY;
  }
  for (const planet of system.planets) {
    const moon = (planet.moons ?? []).find(
      (candidate) => candidate.id === body.id,
    );
    if (moon) {
      return Math.abs(moon.orbitSpeed) > EPSILON
        ? TAU / Math.abs(moon.orbitSpeed)
        : Number.POSITIVE_INFINITY;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function segmentClosestFraction(a: Vector3Tuple, b: Vector3Tuple): number {
  const delta = subtract(b, a);
  const denominator = dot(delta, delta);
  if (denominator <= EPSILON) return 0;
  return clamp(-dot(a, delta) / denominator, 0, 1);
}

function boundaryMetric(
  system: StarSystem,
  boundary: TransferBoundary,
  spacecraftPosition: Vector3Tuple,
  simulationTimeSeconds: number,
): {
  metric: number;
  center: Vector3Tuple;
  relative: Vector3Tuple;
  distance: number;
} {
  const center = bodySystemPositionAtTime(
    system,
    boundary.boundaryBody.id,
    simulationTimeSeconds,
  );
  const relative = subtract(spacecraftPosition, center);
  const distance = magnitude(relative);
  return {
    metric:
      boundary.eventKind === "entry"
        ? distance - boundary.radius
        : boundary.radius - distance,
    center,
    relative,
    distance,
  };
}

function stateOnExactBoundary(
  system: StarSystem,
  boundary: TransferBoundary,
  state: { position: Vector3Tuple; velocity: Vector3Tuple },
  simulationTimeSeconds: number,
): {
  state: { position: Vector3Tuple; velocity: Vector3Tuple };
  center: Vector3Tuple;
} {
  const center = bodySystemPositionAtTime(
    system,
    boundary.boundaryBody.id,
    simulationTimeSeconds,
  );
  const relative = subtract(state.position, center);
  const radial = normalize(relative, [1, 0, 0]);
  return {
    state: {
      position: add(center, multiply(radial, boundary.radius)),
      velocity: state.velocity,
    },
    center,
  };
}

function influencePredictionAtCrossing(
  system: StarSystem,
  primary: FlightBody,
  boundary: TransferBoundary,
  state: { position: Vector3Tuple; velocity: Vector3Tuple },
  crossingTime: number,
  originSimulationTime: number,
  forecastOrbitPeriod: number,
): InfluencePrediction {
  const exact = stateOnExactBoundary(system, boundary, state, crossingTime);
  return {
    fromBodyId: primary.id,
    fromBodyName: primary.name,
    toBodyId: boundary.target.id,
    toBodyName: boundary.target.name,
    toBodyKind: boundary.target.kind,
    eventKind: boundary.eventKind,
    atSimulationTime: crossingTime,
    secondsFromNow: Math.max(0, crossingTime - originSimulationTime),
    orbitsFromNow:
      Math.max(0, crossingTime - originSimulationTime) /
      Math.max(forecastOrbitPeriod, EPSILON),
    atSystemPosition: exact.state.position,
    boundaryCenterSystemPosition: exact.center,
    boundaryRadius: boundary.radius,
    destinationOrbit: destinationOrbitAtTransition(
      system,
      boundary.target,
      exact.state,
      crossingTime,
    ),
  };
}

function destinationOrbitAtTransition(
  system: StarSystem,
  destination: FlightBody,
  state: { position: Vector3Tuple; velocity: Vector3Tuple },
  simulationTimeSeconds: number,
): SpacecraftOrbit {
  const center = bodySystemPositionAtTime(
    system,
    destination.id,
    simulationTimeSeconds,
  );
  const velocity = bodySystemVelocityAtTime(
    system,
    destination.id,
    simulationTimeSeconds,
  );
  return gameOrbitFromState(
    subtract(state.position, center),
    subtract(state.velocity, velocity),
    destination.gravitationalParameter,
    simulationTimeSeconds,
  );
}

interface BoundaryScanResult {
  transition?: InfluencePrediction;
  approach: TransferTargetPrediction;
}

function scanTransferBoundary(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  primary: FlightBody,
  boundary: TransferBoundary,
  simulationTimeSeconds: number,
  plannedSegments: PlannedOrbitSegment[],
  forecastOrbitPeriod: number,
  maxOrbits: number,
): BoundaryScanResult {
  const finalSegment = plannedSegments[plannedSegments.length - 1];
  const planLead = Number.isFinite(finalSegment.startsAt)
    ? Math.max(0, finalSegment.startsAt - simulationTimeSeconds)
    : 0;
  const horizonDuration = planLead + forecastOrbitPeriod * maxOrbits;
  const boundaryPeriod = bodyMotionPeriodSeconds(system, boundary.boundaryBody);
  const samplingPeriod = Number.isFinite(boundaryPeriod)
    ? Math.min(forecastOrbitPeriod, boundaryPeriod)
    : forecastOrbitPeriod;

  // Keep the sampling lattice anchored to absolute simulation time so recalculating
  // the forecast does not move every candidate minimum. Samples only locate a basin;
  // the displayed closest approach is continuously refined inside that basin.
  const desiredStep = Math.max(samplingPeriod / 12, 0.025);
  const rawSteps = Math.max(1, Math.ceil(horizonDuration / desiredStep));
  const stride = Math.max(1, Math.ceil(rawSteps / 8_000));
  const stepDuration = desiredStep * stride;
  const gridOrigin =
    Math.floor(simulationTimeSeconds / stepDuration) * stepDuration;
  const endTime = simulationTimeSeconds + horizonDuration;

  const stateAt = (time: number) =>
    predictedSystemStateAtTime(plan, system, primary, time, plannedSegments);
  const metricAt = (time: number) => {
    const state = stateAt(time);
    return {
      state,
      ...boundaryMetric(system, boundary, state.position, time),
    };
  };

  const finishTransition = (
    lowTime: number,
    highTime: number,
  ): InfluencePrediction => {
    let low = lowTime;
    let high = highTime;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const mid = (low + high) / 2;
      if (metricAt(mid).metric > 0) low = mid;
      else high = mid;
    }
    const crossingTime = high;
    const crossing = metricAt(crossingTime);
    return influencePredictionAtCrossing(
      system,
      primary,
      boundary,
      crossing.state,
      crossingTime,
      simulationTimeSeconds,
      forecastOrbitPeriod,
    );
  };

  const refineMinimum = (lowTime: number, highTime: number) => {
    let low = lowTime;
    let high = highTime;
    const ratio = (Math.sqrt(5) - 1) / 2;
    let left = high - (high - low) * ratio;
    let right = low + (high - low) * ratio;
    let leftMetric = metricAt(left).metric;
    let rightMetric = metricAt(right).metric;
    for (let iteration = 0; iteration < 22; iteration += 1) {
      if (leftMetric <= rightMetric) {
        high = right;
        right = left;
        rightMetric = leftMetric;
        left = high - (high - low) * ratio;
        leftMetric = metricAt(left).metric;
      } else {
        low = left;
        left = right;
        leftMetric = rightMetric;
        right = low + (high - low) * ratio;
        rightMetric = metricAt(right).metric;
      }
    }
    const time = (low + high) / 2;
    return { time, sample: metricAt(time) };
  };

  const first = metricAt(simulationTimeSeconds);
  let best = {
    time: simulationTimeSeconds,
    metric: Math.max(0, first.metric),
    position: first.state.position,
    center: first.center,
  };

  if (first.metric <= 0) {
    const transition = finishTransition(
      simulationTimeSeconds - Math.min(0.001, stepDuration * 0.25),
      simulationTimeSeconds,
    );
    return {
      transition,
      approach: {
        targetBodyId: boundary.target.id,
        targetBodyName: boundary.target.name,
        targetBodyKind: boundary.target.kind,
        eventKind: boundary.eventKind,
        willTransition: true,
        atSimulationTime: transition.atSimulationTime,
        secondsFromNow: transition.secondsFromNow,
        orbitsFromNow: transition.orbitsFromNow,
        boundaryRadius: boundary.radius,
        boundaryGap: 0,
        spacecraftSystemPosition: transition.atSystemPosition,
        boundaryCenterSystemPosition: transition.boundaryCenterSystemPosition,
      },
    };
  }

  let olderTime = simulationTimeSeconds;
  let older = first;
  let previousTime = Math.min(
    endTime,
    gridOrigin +
      (Math.floor((simulationTimeSeconds - gridOrigin) / stepDuration) + 1) *
        stepDuration,
  );
  let previous = metricAt(previousTime);

  const consider = (time: number, sample: ReturnType<typeof metricAt>) => {
    if (sample.metric >= 0 && sample.metric < best.metric) {
      best = {
        time,
        metric: sample.metric,
        position: sample.state.position,
        center: sample.center,
      };
    }
  };
  consider(previousTime, previous);

  let time = previousTime;
  while (time < endTime - EPSILON) {
    time = Math.min(endTime, time + stepDuration);
    const current = metricAt(time);

    if (previous.metric > 0 && current.metric <= 0) {
      const transition = finishTransition(previousTime, time);
      return {
        transition,
        approach: {
          targetBodyId: boundary.target.id,
          targetBodyName: boundary.target.name,
          targetBodyKind: boundary.target.kind,
          eventKind: boundary.eventKind,
          willTransition: true,
          atSimulationTime: transition.atSimulationTime,
          secondsFromNow: transition.secondsFromNow,
          orbitsFromNow: transition.orbitsFromNow,
          boundaryRadius: boundary.radius,
          boundaryGap: 0,
          spacecraftSystemPosition: transition.atSystemPosition,
          boundaryCenterSystemPosition: transition.boundaryCenterSystemPosition,
        },
      };
    }

    // If the middle sample is a basin minimum, solve the continuous minimum instead
    // of reporting whichever discrete sample happened to win this render tick.
    if (
      previous.metric >= 0 &&
      previous.metric <= older.metric &&
      previous.metric <= current.metric
    ) {
      const refined = refineMinimum(olderTime, time);
      if (refined.sample.metric <= 0) {
        const transition = finishTransition(olderTime, refined.time);
        return {
          transition,
          approach: {
            targetBodyId: boundary.target.id,
            targetBodyName: boundary.target.name,
            targetBodyKind: boundary.target.kind,
            eventKind: boundary.eventKind,
            willTransition: true,
            atSimulationTime: transition.atSimulationTime,
            secondsFromNow: transition.secondsFromNow,
            orbitsFromNow: transition.orbitsFromNow,
            boundaryRadius: boundary.radius,
            boundaryGap: 0,
            spacecraftSystemPosition: transition.atSystemPosition,
            boundaryCenterSystemPosition:
              transition.boundaryCenterSystemPosition,
          },
        };
      }
      consider(refined.time, refined.sample);
    }

    // Narrow moving SOIs can still pass completely between coarse samples. The
    // chord test finds those candidate basins, then the continuous solver stabilizes
    // the actual closest approach.
    if (
      boundary.eventKind === "entry" &&
      previous.metric > 0 &&
      current.metric > 0
    ) {
      const fraction = segmentClosestFraction(
        previous.relative,
        current.relative,
      );
      if (fraction > 0.001 && fraction < 0.999) {
        const linearClosest = add(
          previous.relative,
          multiply(subtract(current.relative, previous.relative), fraction),
        );
        if (magnitude(linearClosest) <= boundary.radius * 1.35) {
          const refined = refineMinimum(previousTime, time);
          if (refined.sample.metric <= 0) {
            const transition = finishTransition(previousTime, refined.time);
            return {
              transition,
              approach: {
                targetBodyId: boundary.target.id,
                targetBodyName: boundary.target.name,
                targetBodyKind: boundary.target.kind,
                eventKind: boundary.eventKind,
                willTransition: true,
                atSimulationTime: transition.atSimulationTime,
                secondsFromNow: transition.secondsFromNow,
                orbitsFromNow: transition.orbitsFromNow,
                boundaryRadius: boundary.radius,
                boundaryGap: 0,
                spacecraftSystemPosition: transition.atSystemPosition,
                boundaryCenterSystemPosition:
                  transition.boundaryCenterSystemPosition,
              },
            };
          }
          consider(refined.time, refined.sample);
        }
      }
    }

    consider(time, current);
    olderTime = previousTime;
    older = previous;
    previousTime = time;
    previous = current;
  }

  return {
    approach: {
      targetBodyId: boundary.target.id,
      targetBodyName: boundary.target.name,
      targetBodyKind: boundary.target.kind,
      eventKind: boundary.eventKind,
      willTransition: false,
      atSimulationTime: best.time,
      secondsFromNow: Math.max(0, best.time - simulationTimeSeconds),
      orbitsFromNow:
        Math.max(0, best.time - simulationTimeSeconds) /
        Math.max(forecastOrbitPeriod, EPSILON),
      boundaryRadius: boundary.radius,
      boundaryGap: Math.max(0, best.metric),
      spacecraftSystemPosition: best.position,
      boundaryCenterSystemPosition: best.center,
    },
  };
}

/**
 * Long-horizon patched-conic forecast. It searches at most 1000 future spacecraft
 * orbits, but only for legal next frames. Draft maneuver values are included so the
 * player can steer the forecast before committing the node.
 */
export function predictFlightForecast(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
  maxOrbits = MAX_TRANSFER_SEARCH_ORBITS,
): FlightForecast {
  if (plan.flightState !== "orbiting") return { searchedOrbits: 0 };
  const primary =
    findFlightBody(system, plan.primaryBodyId) ?? buildFlightBodies(system)[0];
  const plannedSegments = plannedOrbitSegmentsForPrediction(
    plan,
    primary,
    simulationTimeSeconds,
  );
  const forecastOrbit = plannedSegments[plannedSegments.length - 1].orbit;
  const forecastPeriod = TAU / Math.max(forecastOrbit.angularSpeed, 0.001);
  const searchedOrbits = Math.round(
    clamp(maxOrbits, 1, MAX_TRANSFER_SEARCH_ORBITS),
  );
  const targets = transferTargetsForPrimary(system, primary.id);
  let nextTransition: InfluencePrediction | undefined;
  let targetApproach: TransferTargetPrediction | undefined;

  for (const target of targets) {
    const boundary = transferBoundaryForTarget(primary, target);
    if (!boundary) continue;
    // The selected destination gets the full long-horizon search. Other legal
    // frames only need a shorter guard horizon to detect an earlier blocking SOI;
    // scanning every planet for 1000 revolutions made live maneuver editing stall.
    const targetSearchOrbits =
      target.id === plan.transferTargetBodyId || targets.length === 1
        ? searchedOrbits
        : Math.min(searchedOrbits, 120);
    const result = scanTransferBoundary(
      plan,
      system,
      primary,
      boundary,
      simulationTimeSeconds,
      plannedSegments,
      forecastPeriod,
      targetSearchOrbits,
    );
    if (
      result.transition &&
      (!nextTransition ||
        result.transition.atSimulationTime < nextTransition.atSimulationTime)
    ) {
      nextTransition = result.transition;
    }
    if (target.id === plan.transferTargetBodyId) {
      targetApproach = result.approach;
    }
  }

  if (
    targetApproach &&
    nextTransition &&
    nextTransition.toBodyId !== targetApproach.targetBodyId &&
    nextTransition.atSimulationTime < targetApproach.atSimulationTime
  ) {
    targetApproach = {
      ...targetApproach,
      blockedByBodyName: nextTransition.toBodyName,
      blockedAtSimulationTime: nextTransition.atSimulationTime,
    };
  }

  return { nextTransition, targetApproach, searchedOrbits };
}

export function predictNextInfluenceTransition(
  plan: ClientSpacecraftPlan,
  system: StarSystem,
  simulationTimeSeconds: number,
  maxOrbits = MAX_TRANSFER_SEARCH_ORBITS,
): InfluencePrediction | undefined {
  return predictFlightForecast(plan, system, simulationTimeSeconds, maxOrbits)
    .nextTransition;
}

export function spacecraftInclinationDegrees(orbit: SpacecraftOrbit): number {
  const normal = normalize(
    cross(orbit.periapsisAxis, orbit.transverseAxis),
    [0, -1, 0],
  );
  return (Math.acos(clamp(dot(normal, [0, -1, 0]), -1, 1)) * 180) / Math.PI;
}

export function formatFlightBodyKind(kind: FlightBodyKind): string {
  if (kind === "star") return "stellar";
  if (kind === "planet") return "planetary";
  return "lunar";
}

export function defaultStarMu(system: StarSystem): number {
  return starFlightMu(system);
}

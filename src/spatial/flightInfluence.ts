import type {
  Moon,
  Planet,
  StarSystem,
  Vector3Tuple,
} from "../domain/universe";
import {
  moonOrbitDefinition,
  orbitPositionAtTime,
  planetOrbitDefinition,
} from "./orbit";

export type FlightBodyKind = "star" | "planet" | "moon";

export interface FlightBody {
  id: string;
  name: string;
  kind: FlightBodyKind;
  parentId?: string;
  /** Planet whose inspection view owns this body. Set for planets and moons. */
  planetId?: string;
  /** Game-flight radius in the same canonical local units used by generated orbits. */
  influenceRadius: number;
  /** Game-scaled gravitational parameter. This is intentionally not SI. */
  gravitationalParameter: number;
  bodyRadius: number;
}

const EPSILON = 1e-6;
const EARTH_MASSES_PER_SOLAR_MASS = 332_946;
const STAR_MU_PER_SOLAR_MASS = 0.451_584;

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(v: Vector3Tuple, scalar: number): Vector3Tuple {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

export function vectorMagnitude(v: Vector3Tuple): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function distanceBetween(a: Vector3Tuple, b: Vector3Tuple): number {
  return vectorMagnitude(subtract(a, b));
}

export function starFlightMu(system: StarSystem): number {
  return STAR_MU_PER_SOLAR_MASS * Math.max(system.primaryMassSolar ?? 1, 0.01);
}

function planetMassProxyEarth(planet: Planet): number {
  // Surface gravity ~= M / R^2. Generated planet radius is already roughly Earth-scale,
  // so g * R^2 is a useful stable gameplay mass proxy without introducing new backend data.
  return Math.max(0.04, planet.gravity * planet.radius * planet.radius);
}

function planetFlightMu(planet: Planet): number {
  const mass = planetMassProxyEarth(planet);
  return 0.024 * Math.pow(mass, 0.72);
}

function moonFlightMu(moon: Moon): number {
  return 0.0036 * Math.max(0.08, moon.radius) ** 2.15;
}

function moonApoapsis(moon: Moon): number {
  return moon.orbitRadius * (1 + (moon.orbitEccentricity ?? 0));
}

function nearestPlanetOrbitGap(system: StarSystem, planet: Planet): number {
  const own = planet.orbitRadius;
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of system.planets) {
    if (candidate.id === planet.id) continue;
    nearest = Math.min(nearest, Math.abs(candidate.orbitRadius - own));
  }
  return Number.isFinite(nearest) ? nearest : Math.max(own * 0.65, 8);
}

function planetInfluenceRadius(system: StarSystem, planet: Planet): number {
  const massEarth = planetMassProxyEarth(planet);
  const massRatio =
    massEarth /
    Math.max((system.primaryMassSolar ?? 1) * EARTH_MASSES_PER_SOLAR_MASS, 1);
  const hillInspired =
    planet.orbitRadius * Math.cbrt(Math.max(massRatio / 3, 1e-12));
  const moonEnvelope = (planet.moons ?? []).reduce(
    (max, moon) => Math.max(max, moonApoapsis(moon)),
    0,
  );
  const visualFloor = Math.max(planet.radius * 3.8, moonEnvelope * 1.28);
  const gameplayReach = Math.max(
    hillInspired * 5.5,
    planet.orbitRadius * 0.038,
  );
  const neighborCap = nearestPlanetOrbitGap(system, planet) * 0.38;
  const orbitalCap = planet.orbitRadius * 0.24;

  // Moon systems must always fit inside their planet's zone, even if that means the
  // zone is larger than the usual neighbor cap for an unusually compact system.
  return Math.max(
    visualFloor,
    Math.min(
      Math.max(gameplayReach, visualFloor),
      Math.max(neighborCap, orbitalCap, visualFloor),
    ),
  );
}

function moonInfluenceRadius(moon: Moon): number {
  const visualFloor = Math.max(moon.radius * 3.4, 0.18);
  const orbitalShare = moon.orbitRadius * 0.105;
  return Math.max(visualFloor, Math.min(orbitalShare, moon.orbitRadius * 0.22));
}

function starInfluenceRadius(system: StarSystem): number {
  const outer = system.planets.reduce(
    (max, planet) =>
      Math.max(max, planet.orbitRadius * (1 + (planet.orbitEccentricity ?? 0))),
    18,
  );
  return Math.max(outer * 1.55, 80);
}

export function buildFlightBodies(system: StarSystem): FlightBody[] {
  const bodies: FlightBody[] = [
    {
      id: system.id,
      name: system.name,
      kind: "star",
      influenceRadius: starInfluenceRadius(system),
      gravitationalParameter: starFlightMu(system),
      bodyRadius: Math.max(system.starRadius, 0.4),
    },
  ];

  for (const planet of system.planets) {
    bodies.push({
      id: planet.id,
      name: planet.name,
      kind: "planet",
      parentId: system.id,
      planetId: planet.id,
      influenceRadius: planetInfluenceRadius(system, planet),
      gravitationalParameter: planetFlightMu(planet),
      bodyRadius: Math.max(planet.radius, 0.18),
    });

    for (const moon of planet.moons ?? []) {
      bodies.push({
        id: moon.id,
        name: moon.name,
        kind: "moon",
        parentId: planet.id,
        planetId: planet.id,
        influenceRadius: moonInfluenceRadius(moon),
        gravitationalParameter: moonFlightMu(moon),
        bodyRadius: Math.max(moon.radius, 0.06),
      });
    }
  }

  return bodies;
}

export function findFlightBody(
  system: StarSystem,
  bodyId: string,
): FlightBody | undefined {
  return buildFlightBodies(system).find((body) => body.id === bodyId);
}

/**
 * The next legal patched-conic frames from the current primary. Transfers are
 * deliberately hierarchical: moon -> planet -> star -> planet -> moon.
 * This keeps planning predictable and means every SOI handoff can be replanned
 * from the frame the ship actually enters.
 */
export function transferTargetsForPrimary(
  system: StarSystem,
  primaryBodyId: string,
): FlightBody[] {
  const bodies = buildFlightBodies(system);
  const primary = bodies.find((body) => body.id === primaryBodyId) ?? bodies[0];

  if (primary.kind === "star") {
    return bodies.filter(
      (body) => body.kind === "planet" && body.parentId === primary.id,
    );
  }

  if (primary.kind === "planet") {
    const parent = bodies.find((body) => body.id === primary.parentId);
    const moons = bodies.filter(
      (body) => body.kind === "moon" && body.parentId === primary.id,
    );
    return parent ? [parent, ...moons] : moons;
  }

  const parent = bodies.find((body) => body.id === primary.parentId);
  return parent ? [parent] : [];
}

function findMoon(
  system: StarSystem,
  moonId: string,
): { planet: Planet; moon: Moon } | undefined {
  for (const planet of system.planets) {
    const moon = (planet.moons ?? []).find(
      (candidate) => candidate.id === moonId,
    );
    if (moon) return { planet, moon };
  }
  return undefined;
}

/** Absolute position inside the star-system canonical flight frame. */
export function bodySystemPositionAtTime(
  system: StarSystem,
  bodyId: string,
  simulationTimeSeconds: number,
): Vector3Tuple {
  if (bodyId === system.id) return [0, 0, 0];

  const planet = system.planets.find((candidate) => candidate.id === bodyId);
  if (planet) {
    return orbitPositionAtTime(
      planetOrbitDefinition(planet),
      simulationTimeSeconds,
    );
  }

  const moonEntry = findMoon(system, bodyId);
  if (moonEntry) {
    const planetPosition = orbitPositionAtTime(
      planetOrbitDefinition(moonEntry.planet),
      simulationTimeSeconds,
    );
    const moonPosition = orbitPositionAtTime(
      moonOrbitDefinition(moonEntry.moon),
      simulationTimeSeconds,
    );
    return add(planetPosition, moonPosition);
  }

  return [0, 0, 0];
}

/** Stable numerical derivative; body motion is cheap and deterministic in this frontend model. */
export function bodySystemVelocityAtTime(
  system: StarSystem,
  bodyId: string,
  simulationTimeSeconds: number,
): Vector3Tuple {
  const dt = 0.025;
  const before = bodySystemPositionAtTime(
    system,
    bodyId,
    simulationTimeSeconds - dt,
  );
  const after = bodySystemPositionAtTime(
    system,
    bodyId,
    simulationTimeSeconds + dt,
  );
  return multiply(subtract(after, before), 1 / (2 * dt));
}

export function bodyPositionRelativeTo(
  system: StarSystem,
  bodyId: string,
  referenceBodyId: string,
  simulationTimeSeconds: number,
): Vector3Tuple {
  return subtract(
    bodySystemPositionAtTime(system, bodyId, simulationTimeSeconds),
    bodySystemPositionAtTime(system, referenceBodyId, simulationTimeSeconds),
  );
}

/**
 * Choose the deepest influence zone containing a system-space point.
 * A small hysteresis margin is applied by callers when retaining the current body.
 */
export function deepestInfluenceBodyAtPosition(
  system: StarSystem,
  position: Vector3Tuple,
  simulationTimeSeconds: number,
  entryFactor = 0.985,
): FlightBody {
  const bodies = buildFlightBodies(system);
  let selected = bodies[0];
  let selectedDepth = 0;
  let selectedRatio = Number.POSITIVE_INFINITY;

  for (const body of bodies) {
    if (body.kind === "star") continue;
    const center = bodySystemPositionAtTime(
      system,
      body.id,
      simulationTimeSeconds,
    );
    const ratio =
      distanceBetween(position, center) /
      Math.max(body.influenceRadius * entryFactor, EPSILON);
    if (ratio > 1) continue;
    const depth = body.kind === "moon" ? 2 : 1;
    if (
      depth > selectedDepth ||
      (depth === selectedDepth && ratio < selectedRatio)
    ) {
      selected = body;
      selectedDepth = depth;
      selectedRatio = ratio;
    }
  }

  return selected;
}

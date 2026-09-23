import { useEffect, useMemo } from 'react'
import { useTable } from 'spacetimedb/react'

import type {
  BlackHole as BlackHoleRow,
  Galaxy as GalaxyRow,
  Moon as MoonRow,
  Planet as PlanetRow,
  VisibleStarSystem as StarSystemRow,
} from '../module_bindings/types'
import { tables } from '../module_bindings'
import type {
  BlackHoleConfig,
  Galaxy,
  GalaxyMorphology,
  Moon,
  Planet,
  PlanetProduction,
  StarSystem,
  SystemMapRole,
  SystemPrimaryKind,
  Vector3Tuple,
} from '../domain/universe'
import { universeRepository } from './UniverseRepository'
import { applySimulationClockSample } from '../spatial/simulationClock'
import { resolveSystemInfluence } from '../domain/systemInfluence'

function convertGalaxy(row: GalaxyRow): Galaxy {
  const inclination: Vector3Tuple | undefined = row.inclination
    ? [row.inclination.x, row.inclination.y, row.inclination.z]
    : undefined

  return {
    id: row.id,
    name: row.name,
    position: [row.position.x, row.position.y, row.position.z],
    radius: row.radius,
    thickness: row.thickness,
    rotation: row.rotation,
    inclination,
    morphology: row.morphology as GalaxyMorphology,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    description: row.description,
    discoveredBy: row.discoveredBy,
    estimatedSystems: row.estimatedSystems,
    seed: row.seed,
    armCount: row.armCount,
    armWinding: row.armWinding,
    home: row.home,
    // Companion rows are not modelled in the backend yet.
    companions: undefined,
  }
}

function convertBlackHole(row: BlackHoleRow | undefined): BlackHoleConfig | undefined {
  if (!row) return undefined

  return {
    massSolar: Number(row.massSolar),
    eventHorizonRadius: row.eventHorizonRadius,
    spin: row.spin,
    photonRingColor: row.photonRingColor,
    accretionDisk: row.accretionDisk
        ? {
          innerRadius: row.accretionDisk.innerRadius,
          outerRadius: row.accretionDisk.outerRadius,
          thickness: row.accretionDisk.thickness,
          tilt: [
            row.accretionDisk.tilt.x,
            row.accretionDisk.tilt.y,
            row.accretionDisk.tilt.z,
          ],
          innerColor: row.accretionDisk.innerColor,
          outerColor: row.accretionDisk.outerColor,
          opacity: row.accretionDisk.opacity,
          luminosity: row.accretionDisk.luminosity,
          rotationSpeed: row.accretionDisk.rotationSpeed,
        }
        : undefined,
    jetColor: row.jetColor,
    jetLength: row.jetLength,
    jetIntensity: row.jetIntensity,
    lensingStrength: row.lensingStrength,
    lensingRadiusMultiplier: row.lensingRadiusMultiplier,
  }
}

function convertMoon(row: MoonRow): Moon {
  return {
    id: row.id,
    name: row.name,
    type: row.moonType,
    radius: row.radius,
    orbitRadius: row.orbitRadius,
    orbitSpeed: row.orbitSpeed,
    orbitOffset: row.orbitOffset,
    orbitInclination: row.orbitInclination,
    orbitEccentricity: row.orbitEccentricity,
    orbitLongitude: row.orbitLongitude,
    orbitArgument: row.orbitArgument,
    color: row.color,
    secondaryColor: row.secondaryColor,
  }
}

function convertProduction(row: PlanetRow['production']): PlanetProduction | undefined {
  if (!row) return undefined

  return {
    unit: row.unit,
    cycle: row.cycle,
    industry: Number(row.industry),
    energy: Number(row.energy),
    resources: Number(row.resources),
    fuel: Number(row.fuel),
    food: Number(row.food),
    research: Number(row.research),
  }
}

function convertPlanet(row: PlanetRow, moons: Moon[]): Planet {
  return {
    id: row.id,
    systemId: row.systemId,
    name: row.name,
    type: row.planetType,
    radius: row.radius,
    orbitRadius: row.orbitRadius,
    orbitSpeed: row.orbitSpeed,
    orbitOffset: row.orbitOffset,
    orbitInclination: row.orbitInclination,
    orbitEccentricity: row.orbitEccentricity,
    orbitLongitude: row.orbitLongitude,
    orbitArgument: row.orbitArgument,
    orbitIndex: row.orbitIndex,
    color: row.color,
    secondaryColor: row.secondaryColor ?? row.color,
    temperature: {
      pole: row.temperature.pole,
      equator: row.temperature.equator,
      substellar: row.temperature.substellar,
      antistellar: row.temperature.antistellar,
    },
    population: Number(row.population),
    colonized: row.colonized,
    production: convertProduction(row.production),
    gravity: row.gravity,
    atmosphere: row.atmosphere,
    description: row.description,
    discoveredBy: row.discoveredBy,
    resources: [...row.resources],
    axialTilt: row.axialTilt,
    tidallyLocked: row.tidallyLocked,
    landFraction: row.landFraction,
    ringColor: row.ringColor,
    moons,
    // Surface-point visibility/data can be added as another planet-derived
    // view without changing the system/planet/moon assembly below.
    surfacePoints: [],
  }
}

function convertSystem(row: StarSystemRow, planets: Planet[]): StarSystem {
  const blackHole = convertBlackHole(row.blackHole)
  const influence = resolveSystemInfluence({
    primaryMassSolar: row.primaryMassSolar,
    influenceRadius: row.influenceRadius,
    influenceStrength: row.influenceStrength,
    starRadius: row.starRadius,
    spectralType: row.spectralType,
    blackHole,
  })

  return {
    id: row.id,
    galaxyId: row.galaxyId,
    name: row.name,
    position: [row.position.x, row.position.y, row.position.z],
    primaryKind: row.primaryKind as SystemPrimaryKind,
    mapRole: row.mapRole as SystemMapRole,
    spectralType: row.spectralType,
    starColor: row.starColor,
    starRadius: row.starRadius,
    primaryMassSolar: influence.primaryMassSolar,
    influenceRadius: influence.influenceRadius,
    influenceStrength: influence.influenceStrength,
    blackHole,
    zoneColor: row.zoneColor,
    zoneRadius: row.zoneRadius,
    zoneStrength: row.zoneStrength,
    zoneName: row.zoneName,
    owner: row.ownerIdentity
      ? { playerId: row.ownerIdentity.toHexString() }
      : undefined,
    description: row.description,
    faction: row.faction,
    population: row.population.toString(),
    planets,
  }
}

export function UniverseSpaceTimeBridge() {
  const [galaxyRows, galaxiesReady] = useTable(tables.visible_galaxies)
  const [systemRows, systemsReady] = useTable(tables.visible_systems)
  const [planetRows, planetsReady] = useTable(tables.visible_planets)
  const [moonRows, moonsReady] = useTable(tables.visible_moons)
  //const [clockRows] = useTable(tables.simulationClock)

  const galaxies = useMemo(
    () => galaxyRows.map(convertGalaxy),
    [galaxyRows],
  )

  const moonsByPlanetId = useMemo(() => {
    const result = new Map<string, Moon[]>()

    moonRows.forEach((row) => {
      const moons = result.get(row.planetId)
      const moon = convertMoon(row)
      if (moons) moons.push(moon)
      else result.set(row.planetId, [moon])
    })

    for (const moons of result.values()) {
      moons.sort((left, right) => left.orbitRadius - right.orbitRadius)
    }

    return result
  }, [moonRows])

  const planetsBySystemId = useMemo(() => {
    const result = new Map<string, Planet[]>()

    planetRows.forEach((row) => {
      const planets = result.get(row.systemId)
      const planet = convertPlanet(row, moonsByPlanetId.get(row.id) ?? [])
      if (planets) planets.push(planet)
      else result.set(row.systemId, [planet])
    })

    for (const planets of result.values()) {
      planets.sort((left, right) => (left.orbitIndex ?? 0) - (right.orbitIndex ?? 0))
    }

    return result
  }, [moonsByPlanetId, planetRows])

  const systems = useMemo(
    () => systemRows.map((row) => convertSystem(row, planetsBySystemId.get(row.id) ?? [])),
    [planetsBySystemId, systemRows],
  )

/*
  useEffect(() => {
    const sample = clockRows[0]
    if (!sample) return
    applySimulationClockSample({
      simulationTimeSeconds: sample.simulationTimeSeconds,
      timeScale: sample.timeScale,
      revision: sample.revision,
    })
  }, [clockRows]) */

  useEffect(() => {
    if (!galaxiesReady || !systemsReady || !planetsReady || !moonsReady) return
    universeRepository.setVisibleData(galaxies, systems)
  }, [
    galaxies,
    galaxiesReady,
    moonsReady,
    planetsReady,
    systems,
    systemsReady,
  ])

  return null
}

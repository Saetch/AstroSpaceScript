import type { Planet, StarSystem, UniverseSnapshot } from '../domain/universe'
import { mockGalaxies, mockSystems, mockTrafficRoutes } from './mockUniverse'

export type UniverseListener = () => void

export interface UniverseRepository {
  getSnapshot(): UniverseSnapshot
  subscribe(listener: UniverseListener): () => void
  connect(): void
  disconnect(): void
  /** Keep a full system record/subscription available while navigating inside it. */
  retainSystem(systemId: string): void
  /** Release a previously retained system after leaving its navigation subtree. */
  releaseSystem(systemId: string): void
  colonizePlanet(systemId: string, planetId: string): Promise<void>
}

function colonizedPlanet(planet: Planet): Planet {
  const hasSettlement = planet.surfacePoints.some((point) => point.kind === 'settlement')
  return {
    ...planet,
    colonized: true,
    population: Math.max(planet.population, 2500),
    production: planet.production ?? {
      unit: 't',
      cycle: 'day',
      industry: 14,
      energy: 32,
      resources: 21,
      fuel: 6,
      food: 18,
      research: 4,
    },
    surfacePoints: hasSettlement
      ? planet.surfacePoints
      : [
          ...planet.surfacePoints,
          {
            id: `${planet.id}-pioneer-landing`,
            label: 'Pioneer Landing',
            kind: 'settlement',
            latitude: 18,
            longitude: -28,
            description: 'The first permanent colonial foothold, supplied by an orbital construction flotilla.',
            visualScale: 0.72,
          },
        ],
  }
}

function colonizedSystem(system: StarSystem, planetId: string): StarSystem {
  const target = system.planets.find((planet) => planet.id === planetId)
  if (!target || target.colonized) return system

  return {
    ...system,
    zoneColor: system.zoneColor ?? '#45c7ff',
    zoneRadius: system.zoneRadius ?? 28,
    zoneStrength: system.zoneStrength ?? 0.24,
    zoneName: system.zoneName ?? 'Atlas Compact',
    faction: system.faction === 'Unclaimed' ? 'Atlas Compact Colony' : system.faction,
    population: system.population === '0' ? '2,500' : system.population,
    planets: system.planets.map((planet) => (planet.id === planetId ? colonizedPlanet(planet) : planet)),
  }
}

export class MockUniverseRepository implements UniverseRepository {
  private listeners = new Set<UniverseListener>()
  private retainedSystems = new Map<string, number>()

  private snapshot: UniverseSnapshot = {
    galaxies: structuredClone(mockGalaxies),
    systems: structuredClone(mockSystems),
    trafficRoutes: structuredClone(mockTrafficRoutes),
    connection: 'mock',
    updatedAt: new Date().toISOString(),
    onlinePlayers: 128,
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: UniverseListener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect = () => undefined
  disconnect = () => undefined

  retainSystem = (systemId: string) => {
    this.retainedSystems.set(systemId, (this.retainedSystems.get(systemId) ?? 0) + 1)
  }

  releaseSystem = (systemId: string) => {
    const remaining = (this.retainedSystems.get(systemId) ?? 1) - 1
    if (remaining > 0) this.retainedSystems.set(systemId, remaining)
    else this.retainedSystems.delete(systemId)
  }

  colonizePlanet = async (systemId: string, planetId: string) => {
    const system = this.snapshot.systems.find((item) => item.id === systemId)
    const planet = system?.planets.find((item) => item.id === planetId)
    if (!system || !planet) throw new Error('Planet not found')
    if (planet.colonized) return

    this.snapshot = {
      ...this.snapshot,
      systems: this.snapshot.systems.map((item) => (item.id === systemId ? colonizedSystem(item, planetId) : item)),
      updatedAt: new Date().toISOString(),
    }
    this.listeners.forEach((listener) => listener())
  }
}

export const universeRepository: UniverseRepository = new MockUniverseRepository()

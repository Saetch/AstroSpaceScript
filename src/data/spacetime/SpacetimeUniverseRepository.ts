import type { Galaxy, UniverseSnapshot } from '../../domain/universe'
import type { UniverseListener, UniverseRepository } from '../UniverseRepository'

export interface SpacetimeUniverseAdapter {
  connect(handlers: {
    onSnapshot: (snapshot: UniverseSnapshot) => void
    onError: (error: unknown) => void
  }): void | Promise<void>
  disconnect(): void
  /** Optional narrow subscription hook for a full selected-system payload. */
  retainSystem?(systemId: string): void | Promise<void>
  /** Optional counterpart used after leaving the selected system. */
  releaseSystem?(systemId: string): void | Promise<void>
  colonizePlanet?(systemId: string, planetId: string): void | Promise<void>
}

const EMPTY_SNAPSHOT: UniverseSnapshot = {
  galaxies: [],
  systems: [],
  trafficRoutes: [],
  connection: 'offline',
  updatedAt: new Date(0).toISOString(),
  onlinePlayers: 0,
}

/**
 * Repository wrapper for generated SpaceTimeDB bindings.
 *
 * The adapter is intentionally separate so generated DbConnection/table types
 * stay outside rendering code. Feed fully normalized snapshots into onSnapshot.
 */
export class SpacetimeUniverseRepository implements UniverseRepository {
  private listeners = new Set<UniverseListener>()
  private snapshot: UniverseSnapshot
  private retainedSystemRefs = new Map<string, number>()
  private retainedSystemCache = new Map<string, UniverseSnapshot['systems'][number]>()

  constructor(
    private readonly adapter: SpacetimeUniverseAdapter,
    initialSnapshot: UniverseSnapshot = EMPTY_SNAPSHOT,
  ) {
    this.snapshot = initialSnapshot
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: UniverseListener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect = () => {
    this.setSnapshot({ ...this.snapshot, connection: 'connecting' })
    void this.adapter.connect({
      onSnapshot: (snapshot) => this.setSnapshot({ ...snapshot, connection: 'live' }),
      onError: () => this.setSnapshot({ ...this.snapshot, connection: 'offline' }),
    })
  }

  disconnect = () => {
    this.adapter.disconnect()
    this.setSnapshot({ ...this.snapshot, connection: 'offline' })
  }

  setGalaxies(galaxies: Galaxy[]): void {
    const previousById = new Map(
        this.snapshot.galaxies.map(galaxy => [
          galaxy.id,
          galaxy,
        ]),
    )

    let changed =
        galaxies.length !== this.snapshot.galaxies.length

    const mergedGalaxies = galaxies.map(next => {
      const previous = previousById.get(next.id)

      if (previous && sameGalaxy(previous, next)) {
        // Keep the exact same JavaScript object.
        return previous
      }

      changed = true
      return next
    })

    if (!changed) return

    this.snapshot = {
      ...this.snapshot,
      galaxies: mergedGalaxies,
      connection: 'live',
      updatedAt: new Date().toISOString(),
    }

    this.listeners.forEach(listener => listener())
  }




  retainSystem = (systemId: string) => {
    this.retainedSystemRefs.set(systemId, (this.retainedSystemRefs.get(systemId) ?? 0) + 1)
    const current = this.snapshot.systems.find((system) => system.id === systemId)
    if (current) this.retainedSystemCache.set(systemId, current)
    void this.adapter.retainSystem?.(systemId)
  }

  releaseSystem = (systemId: string) => {
    const remaining = (this.retainedSystemRefs.get(systemId) ?? 1) - 1
    if (remaining > 0) {
      this.retainedSystemRefs.set(systemId, remaining)
      return
    }
    this.retainedSystemRefs.delete(systemId)
    this.retainedSystemCache.delete(systemId)
    void this.adapter.releaseSystem?.(systemId)
  }

  colonizePlanet = async (systemId: string, planetId: string) => {
    if (!this.adapter.colonizePlanet) {
      throw new Error('The SpaceTimeDB adapter does not expose a colonization reducer yet.')
    }
    await this.adapter.colonizePlanet(systemId, planetId)
  }

  private setSnapshot(snapshot: UniverseSnapshot) {
    snapshot.systems.forEach((system) => {
      if (this.retainedSystemRefs.has(system.id)) this.retainedSystemCache.set(system.id, system)
    })

    const presentIds = new Set(snapshot.systems.map((system) => system.id))
    const retainedMissing = [...this.retainedSystemRefs.keys()]
      .filter((systemId) => !presentIds.has(systemId))
      .map((systemId) => this.retainedSystemCache.get(systemId))
      .filter((system): system is UniverseSnapshot['systems'][number] => Boolean(system))

    this.snapshot = retainedMissing.length > 0
      ? { ...snapshot, systems: [...snapshot.systems, ...retainedMissing] }
      : snapshot
    this.listeners.forEach((listener) => listener())
  }
}


function sameVector(
    left?: readonly number[],
    right?: readonly number[],
) {
  if (left === right) return true
  if (!left || !right) return left === right

  return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
  )
}

function sameGalaxy(
    previous: Galaxy,
    next: Galaxy,
): boolean {
  return (
      previous.id === next.id &&
      previous.name === next.name &&
      sameVector(previous.position, next.position) &&
      sameVector(previous.inclination, next.inclination) &&
      previous.radius === next.radius &&
      previous.thickness === next.thickness &&
      previous.rotation === next.rotation &&
      previous.morphology === next.morphology &&
      previous.primaryColor === next.primaryColor &&
      previous.secondaryColor === next.secondaryColor &&
      previous.description === next.description &&
      previous.discoveredBy === next.discoveredBy &&
      previous.estimatedSystems === next.estimatedSystems &&
      previous.seed === next.seed &&
      previous.armCount === next.armCount &&
      previous.armWinding === next.armWinding &&
      previous.barLength === next.barLength &&
      previous.home === next.home
  )
}

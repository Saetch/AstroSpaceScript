import type { UniverseSnapshot } from '../../domain/universe'
import type { UniverseListener, UniverseRepository } from '../UniverseRepository'

export interface SpacetimeUniverseAdapter {
  connect(handlers: {
    onSnapshot: (snapshot: UniverseSnapshot) => void
    onError: (error: unknown) => void
  }): void | Promise<void>
  disconnect(): void
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

  colonizePlanet = async (systemId: string, planetId: string) => {
    if (!this.adapter.colonizePlanet) {
      throw new Error('The SpaceTimeDB adapter does not expose a colonization reducer yet.')
    }
    await this.adapter.colonizePlanet(systemId, planetId)
  }

  private setSnapshot(snapshot: UniverseSnapshot) {
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
  }
}

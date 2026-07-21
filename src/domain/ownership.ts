import type { Planet, PlayerIdentity, PlayerOwnership, StarSystem } from './universe'

export type OwnershipRelation = 'self' | 'other' | 'unclaimed'

export interface ResolvedOwnership {
  relation: OwnershipRelation
  playerId?: string
  playerName?: string
}

export function resolveOwnership(
  owner: PlayerOwnership | undefined,
  currentPlayer: PlayerIdentity,
): ResolvedOwnership {
  if (!owner) return { relation: 'unclaimed' }

  const sameStableId = Boolean(
    owner.playerId
      && currentPlayer.id
      && owner.playerId === currentPlayer.id,
  )

  if (owner.isCurrentPlayer || sameStableId) {
    return {
      relation: 'self',
      playerId: currentPlayer.id ?? owner.playerId,
      playerName: currentPlayer.name,
    }
  }

  return {
    relation: 'other',
    playerId: owner.playerId,
    playerName: owner.playerName ?? 'Unknown player',
  }
}

/** A colonized planet inherits its system owner until the backend provides a planet-specific owner. */
export function resolvePlanetOwnership(
  planet: Planet,
  system: StarSystem,
  currentPlayer: PlayerIdentity,
) {
  const owner = planet.owner ?? (planet.colonized ? system.owner : undefined)
  return resolveOwnership(owner, currentPlayer)
}

export function ownershipKey(owner: PlayerOwnership | undefined) {
  if (!owner) return 'unclaimed'
  if (owner.isCurrentPlayer) return 'self'
  return owner.playerId ?? owner.playerName ?? 'unknown-player'
}

export function systemOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'YOUR SYSTEM'
  if (ownership.relation === 'other') return ownership.playerName ?? 'PLAYER SYSTEM'
  return 'UNCLAIMED'
}

export function planetOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'YOUR COLONY'
  if (ownership.relation === 'other') return ownership.playerName ?? 'PLAYER COLONY'
  return 'UNCLAIMED WORLD'
}

export function territoryOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'Your territory'
  if (ownership.relation === 'other') return `${ownership.playerName ?? 'Player'} territory`
  return 'Unclaimed territory'
}

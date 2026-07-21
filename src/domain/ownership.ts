import { PlayerRelation, type Planet, type PlayerIdentity, type PlayerOwnership, type StarSystem } from './universe'

export type OwnershipRelation = 'self' | 'other' | 'unclaimed'
export type OwnershipTone = 'self' | 'unclaimed' | PlayerRelation

export interface ResolvedOwnership {
  relation: OwnershipRelation
  diplomacy?: PlayerRelation
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
    diplomacy: owner.relation ?? PlayerRelation.Neutral,
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

export function ownershipTone(ownership: ResolvedOwnership | undefined): OwnershipTone {
  if (!ownership || ownership.relation === 'unclaimed') return 'unclaimed'
  if (ownership.relation === 'self') return 'self'
  return ownership.diplomacy ?? PlayerRelation.Neutral
}

export function playerRelationLabel(ownership: ResolvedOwnership | undefined) {
  if (!ownership || ownership.relation === 'unclaimed') return 'Unclaimed'
  if (ownership.relation === 'self') return 'Yours'

  switch (ownership.diplomacy ?? PlayerRelation.Neutral) {
    case PlayerRelation.Friendly:
      return 'Friendly'
    case PlayerRelation.Allied:
      return 'Allied'
    case PlayerRelation.ColdWar:
      return 'Cold War'
    case PlayerRelation.Enemy:
      return 'Enemy · At War'
    case PlayerRelation.Neutral:
    default:
      return 'Neutral'
  }
}

export function ownershipBadgeLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'YOURS'
  if (ownership.relation === 'unclaimed') return 'OPEN'

  switch (ownership.diplomacy ?? PlayerRelation.Neutral) {
    case PlayerRelation.Friendly:
      return 'FRIEND'
    case PlayerRelation.Allied:
      return 'ALLY'
    case PlayerRelation.ColdWar:
      return 'COLD WAR'
    case PlayerRelation.Enemy:
      return 'WAR'
    case PlayerRelation.Neutral:
    default:
      return 'NEUTRAL'
  }
}

export function relationshipDescription(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') {
    return 'This territory is under your direct control.'
  }
  if (ownership.relation === 'unclaimed') {
    return 'No registered player currently controls this location.'
  }

  switch (ownership.diplomacy ?? PlayerRelation.Neutral) {
    case PlayerRelation.Friendly:
      return 'Friendly relations permit routine access and cooperation.'
    case PlayerRelation.Allied:
      return 'An allied player controls this location under a mutual-defense relationship.'
    case PlayerRelation.ColdWar:
      return 'Relations are hostile but no declared war is currently active.'
    case PlayerRelation.Enemy:
      return 'This location is controlled by an enemy player during an active war.'
    case PlayerRelation.Neutral:
    default:
      return 'No formal cooperation or conflict is currently registered.'
  }
}

export function systemOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'YOUR SYSTEM'
  if (ownership.relation === 'other') {
    return `${playerRelationLabel(ownership).toUpperCase()} · ${ownership.playerName ?? 'PLAYER'}`
  }
  return 'UNCLAIMED'
}

export function planetOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'YOUR COLONY'
  if (ownership.relation === 'other') {
    return `${playerRelationLabel(ownership).toUpperCase()} · ${ownership.playerName ?? 'PLAYER'}`
  }
  return 'UNCLAIMED WORLD'
}

export function territoryOwnershipLabel(ownership: ResolvedOwnership) {
  if (ownership.relation === 'self') return 'Your territory'
  if (ownership.relation === 'other') return `${ownership.playerName ?? 'Player'} territory`
  return 'Unclaimed territory'
}

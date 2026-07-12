import type { Planet, Vector3Tuple } from '../domain/universe'

export function buildPlanetSeedKey(systemPosition: Vector3Tuple, planetIndex: number) {
  return `${systemPosition.map((value) => value.toFixed(3)).join('|')}::${planetIndex}`
}

export function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function describePlanetArchetype(planet: Planet) {
  const type = planet.type.toLowerCase()
  const atmosphere = planet.atmosphere.toLowerCase()
  const resources = planet.resources.join(' ').toLowerCase()

  if (type.includes('gas giant')) return 'gas-giant' as const
  if (type.includes('ice giant')) return 'ice-giant' as const
  if (type.includes('frozen') || type.includes('icy') || type.includes('ice world')) return 'icy' as const
  if (type.includes('ocean')) return 'oceanic' as const
  if (type.includes('ice')) return 'icy' as const
  if (type.includes('volcanic') || atmosphere.includes('sulfur')) return 'volcanic' as const
  if (type.includes('desert')) return 'desert' as const
  if (resources.includes('water') || atmosphere.includes('water vapor') || type.includes('temperate')) return 'terrestrial-ocean' as const
  return 'rocky' as const
}

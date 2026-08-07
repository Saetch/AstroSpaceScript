export interface SystemInfluenceSource {
  primaryMassSolar?: number
  influenceRadius?: number
  influenceStrength?: number
  starRadius?: number
  spectralType?: string
  blackHole?: {
    massSolar?: number
  }
}

export interface ResolvedSystemInfluence {
  primaryMassSolar: number
  influenceRadius: number
  influenceStrength: number
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function approximatePrimaryMass(source: SystemInfluenceSource): number {
  if (finitePositive(source.primaryMassSolar)) return source.primaryMassSolar
  if (finitePositive(source.blackHole?.massSolar)) return source.blackHole.massSolar

  // This branch only supports older rows that predate the explicit mass field.
  // Radius is a better approximation than silently rendering NaN, while the
  // spectral fallback keeps very old rows in a sensible stellar range.
  if (finitePositive(source.starRadius)) return Math.max(0.08, source.starRadius)

  switch (source.spectralType?.trim().charAt(0).toUpperCase()) {
    case 'O': return 20
    case 'B': return 7
    case 'A': return 2.1
    case 'F': return 1.3
    case 'K': return 0.75
    case 'M': return 0.35
    case 'D': return 0.6
    default: return 1
  }
}

export function resolveSystemInfluence(source: SystemInfluenceSource): ResolvedSystemInfluence {
  const primaryMassSolar = approximatePrimaryMass(source)
  const calculatedRadius = Math.min(96, Math.max(28, 22 + 16 * Math.cbrt(Math.max(0.08, primaryMassSolar))))
  const calculatedStrength = Math.min(1.6, Math.max(0.28, 0.24 + 0.3 * Math.pow(Math.max(0.08, primaryMassSolar), 0.28)))

  return {
    primaryMassSolar,
    influenceRadius: finitePositive(source.influenceRadius) ? source.influenceRadius : calculatedRadius,
    influenceStrength: finitePositive(source.influenceStrength) ? source.influenceStrength : calculatedStrength,
  }
}

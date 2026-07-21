export type Vector3Tuple = [number, number, number]

export type ConnectionState = 'mock' | 'connecting' | 'live' | 'offline'

export interface PlayerIdentity {
  /** Stable authenticated user id, such as the OIDC `sub` claim. */
  id?: string
  name: string
}

export interface PlayerOwnership {
  /** Stable backend player id. Prefer this over comparing display names. */
  playerId?: string
  /** Last known display name for UI and offline snapshots. */
  playerName?: string
  /** Temporary mock/client hint until ownership is supplied by SpacetimeDB. */
  isCurrentPlayer?: boolean
}

export type SystemPrimaryKind = 'star' | 'black-hole'
export type SystemMapRole = 'standard' | 'galactic-core'

export interface AccretionDiskConfig {
  innerRadius: number
  outerRadius: number
  thickness: number
  tilt: Vector3Tuple
  innerColor: string
  outerColor: string
  opacity: number
  luminosity: number
  rotationSpeed: number
}

export interface BlackHoleConfig {
  massSolar: number
  eventHorizonRadius: number
  spin: number
  photonRingColor: string
  accretionDisk?: AccretionDiskConfig
  jetColor?: string
  jetLength?: number
  jetIntensity?: number
  /** Screen-space point-mass lensing strength used only for presentation. */
  lensingStrength?: number
  /** Multiplier applied to the visible lensing field around the accretion disc. */
  lensingRadiusMultiplier?: number
}

export type GalaxyMorphology = 'spiral' | 'barred-spiral' | 'elliptical' | 'irregular'

export type GalaxyInteractionPhase = 'bound' | 'close-pass' | 'merging'

export interface GalaxyInteraction {
  phase: GalaxyInteractionPhase
  distortion: number
  bridgeStrength: number
  tailStrength?: number
  envelopeStrength?: number
}

export interface GalaxyCompanion {
  id: string
  name: string
  offset: Vector3Tuple
  radius: number
  thickness: number
  rotation: number
  inclination?: Vector3Tuple
  morphology: GalaxyMorphology
  primaryColor: string
  secondaryColor: string
  seed: number
  armCount?: number
  armWinding?: number
  barLength?: number
  interaction?: GalaxyInteraction
}

export interface Galaxy {
  id: string
  name: string
  position: Vector3Tuple
  radius: number
  thickness: number
  rotation: number
  inclination?: Vector3Tuple
  morphology: GalaxyMorphology
  primaryColor: string
  secondaryColor: string
  description: string
  discoveredBy: string
  estimatedSystems: string
  seed: number
  armCount?: number
  armWinding?: number
  barLength?: number
  companions?: GalaxyCompanion[]
  home?: boolean
}

export type SurfaceVisualType =
  | 'settlement-land'
  | 'settlement-water'
  | 'vault'
  | 'anomaly'
  | 'resource'
  | 'mission'

export interface SurfacePoint {
  id: string
  label: string
  kind: 'settlement' | 'resource' | 'anomaly' | 'mission'
  latitude: number
  longitude: number
  description: string
  visualType?: SurfaceVisualType
  visualScale?: number
}

export interface PlanetTemperatureProfile {
  pole: number
  equator: number
  substellar: number
  antistellar: number
}

export interface PlanetProduction {
  unit: string
  cycle: string
  industry?: number
  energy?: number
  resources?: number
  fuel?: number
  food?: number
  research?: number
}

export interface Moon {
  id: string
  name: string
  type: string
  radius: number
  orbitRadius: number
  orbitSpeed: number
  orbitOffset: number
  /** Orbital-plane inclination in degrees, supplied by the backend. */
  orbitInclination?: number
  color: string
  secondaryColor?: string
  colonized?: boolean
  population?: number
}

export interface Planet {
  id: string
  systemId: string
  name: string
  type: string
  radius: number
  orbitRadius: number
  orbitSpeed: number
  orbitOffset: number
  /** Orbital-plane inclination in degrees, supplied by the backend. */
  orbitInclination?: number
  orbitIndex?: number
  color: string
  secondaryColor: string
  temperature: PlanetTemperatureProfile
  population: number
  colonized: boolean
  /** Player claim. Omit for an unclaimed world; a colonized world may inherit its system owner. */
  owner?: PlayerOwnership
  /** Target exposed land coverage (0..1). Ocean worlds are visually clamped to 0..0.07. */
  landFraction?: number
  production?: PlanetProduction
  gravity: number
  atmosphere: string
  description: string
  discoveredBy: string
  resources: string[]
  ringColor?: string
  axialTilt: number
  tidallyLocked?: boolean
  moons?: Moon[]
  surfacePoints: SurfacePoint[]
}

export interface StarSystem {
  id: string
  galaxyId: string
  name: string
  position: Vector3Tuple
  primaryKind?: SystemPrimaryKind
  /** Optional backend-owned presentation role in the galaxy map. */
  mapRole?: SystemMapRole
  spectralType: string
  starColor: string
  starRadius: number
  blackHole?: BlackHoleConfig
  zoneColor?: string
  zoneRadius?: number
  zoneStrength?: number
  zoneName?: string
  /** Player claim. Omit for an unclaimed system or non-player landmark. */
  owner?: PlayerOwnership
  description: string
  faction: string
  population: string
  planets: Planet[]
}


export type TrafficRouteDirection = 'bidirectional' | 'from-to' | 'to-from'
export type TrafficRouteKind = 'civilian' | 'freight' | 'military' | 'research' | 'mixed'

/**
 * Authoritative inter-system traffic connection.
 *
 * Traffic values are normalized to 0..1 by the frontend. `traffic` remains a
 * backwards-compatible default, while `trafficFromTo` and `trafficToFrom` let
 * the backend provide asymmetric volume for each direction.
 */
export interface TrafficRoute {
  id: string
  galaxyId: string
  fromSystemId: string
  toSystemId: string
  traffic: number
  trafficFromTo?: number
  trafficToFrom?: number
  direction?: TrafficRouteDirection
  kind?: TrafficRouteKind
  color?: string
  speed?: number
  laneOffset?: number
  arcHeight?: number
  label?: string
  active?: boolean
}

export interface UniverseSnapshot {
  galaxies: Galaxy[]
  systems: StarSystem[]
  trafficRoutes: TrafficRoute[]
  connection: ConnectionState
  updatedAt: string
  onlinePlayers: number
}

export type ViewState =
  | { type: 'universe' }
  | { type: 'galaxy'; galaxyId: string }
  | { type: 'system'; galaxyId: string; systemId: string }
  | { type: 'planet'; galaxyId: string; systemId: string; planetId: string }

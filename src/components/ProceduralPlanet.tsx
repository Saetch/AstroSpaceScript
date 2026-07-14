import { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Planet } from '../domain/universe'
import { describePlanetArchetype, hashSeed } from '../procedural/planetSeed'

type DetailLevel = 'system' | 'detail'
type PlanetArchetype = ReturnType<typeof describePlanetArchetype>

type PlanetMaps = {
  colorMap: THREE.CanvasTexture
  bumpMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
  alphaCloudMap: THREE.CanvasTexture
  atmosphereColor?: string
  cloudOpacity: number
  displacementScale: number
  bumpScale: number
}

type PlanetMapCacheEntry = {
  maps: PlanetMaps
  users: number
  lastUsed: number
}

const PLANET_MAP_CACHE_LIMIT = 12
const planetMapCache = new Map<string, PlanetMapCacheEntry>()
let planetMapCacheTrimTimer: ReturnType<typeof setTimeout> | undefined

function disposePlanetMaps(maps: PlanetMaps) {
  maps.colorMap.dispose()
  maps.bumpMap.dispose()
  maps.roughnessMap.dispose()
  maps.emissiveMap.dispose()
  maps.alphaCloudMap.dispose()
}

function trimPlanetMapCache() {
  planetMapCacheTrimTimer = undefined
  if (planetMapCache.size <= PLANET_MAP_CACHE_LIMIT) return

  const removable = [...planetMapCache.entries()]
    .filter(([, entry]) => entry.users === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

  for (const [key, entry] of removable) {
    if (planetMapCache.size <= PLANET_MAP_CACHE_LIMIT) break
    planetMapCache.delete(key)
    disposePlanetMaps(entry.maps)
  }
}

function schedulePlanetMapCacheTrim() {
  if (planetMapCacheTrimTimer !== undefined) return
  planetMapCacheTrimTimer = setTimeout(trimPlanetMapCache, 0)
}

function planetVisualCacheKey(planet: Planet, seedKey: string, detail: DetailLevel) {
  return JSON.stringify({
    seedKey,
    detail,
    id: planet.id,
    type: planet.type,
    radius: planet.radius,
    color: planet.color,
    secondaryColor: planet.secondaryColor,
    temperature: planet.temperature,
    population: planet.population,
    landFraction: planet.landFraction,
    atmosphere: planet.atmosphere,
    tidallyLocked: planet.tidallyLocked,
  })
}

function getCachedPlanetMaps(planet: Planet, seedKey: string, detail: DetailLevel) {
  const key = planetVisualCacheKey(planet, seedKey, detail)
  const existing = planetMapCache.get(key)
  if (existing) {
    existing.lastUsed = performance.now()
    return { key, entry: existing }
  }

  const entry: PlanetMapCacheEntry = {
    maps: createPlanetMaps(planet, seedKey, detail),
    users: 0,
    lastUsed: performance.now(),
  }
  planetMapCache.set(key, entry)
  schedulePlanetMapCacheTrim()
  return { key, entry }
}

type SurfaceShape = {
  heightValue: number
  isOcean: boolean
  altitude: number
  mountainFactor: number
  lavaFactor: number
  detailNoise: number
  ridged: number
  stormNoise: number
  latitudeMask: number
  polarMask: number
  iceFactor: number
  localTemperature: number
}

type UrbanCluster = {
  x: number
  y: number
  z: number
  radiusSquared: number
  density: number
  warmth: number
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function hash3D(x: number, y: number, z: number, seed: number) {
  let hash = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967295
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function valueNoise3D(x: number, y: number, z: number, seed: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const z1 = z0 + 1
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const tz = fade(z - z0)

  const c000 = hash3D(x0, y0, z0, seed)
  const c100 = hash3D(x1, y0, z0, seed)
  const c010 = hash3D(x0, y1, z0, seed)
  const c110 = hash3D(x1, y1, z0, seed)
  const c001 = hash3D(x0, y0, z1, seed)
  const c101 = hash3D(x1, y0, z1, seed)
  const c011 = hash3D(x0, y1, z1, seed)
  const c111 = hash3D(x1, y1, z1, seed)

  const x00 = lerp(c000, c100, tx)
  const x10 = lerp(c010, c110, tx)
  const x01 = lerp(c001, c101, tx)
  const x11 = lerp(c011, c111, tx)
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz)
}

function fbm3D(x: number, y: number, z: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5) {
  let amplitude = 0.5
  let frequency = 1
  let total = 0
  let normalizer = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise3D(x * frequency, y * frequency, z * frequency, seed + octave * 977) * amplitude
    normalizer += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return total / normalizer
}

function ridged3D(x: number, y: number, z: number, seed: number, octaves: number) {
  let amplitude = 0.5
  let frequency = 1
  let total = 0
  let normalizer = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    const base = valueNoise3D(x * frequency, y * frequency, z * frequency, seed + octave * 613)
    total += (1 - Math.abs(base * 2 - 1)) * amplitude
    normalizer += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return total / normalizer
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function atmosphereColorFor(planet: Planet) {
  const atmosphere = planet.atmosphere.toLowerCase()
  if (atmosphere.includes('oxygen') || atmosphere.includes('nitrogen')) return '#87c7ff'
  if (atmosphere.includes('water')) return '#9ee6ff'
  if (atmosphere.includes('methane')) return '#7ce6ff'
  if (atmosphere.includes('sulfur')) return '#ff934b'
  if (atmosphere.includes('carbon dioxide')) return '#ffd0a8'
  if (atmosphere.includes('thin')) return '#c7d8ff'
  return '#bfd6ff'
}

function buildCanvas(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  return canvas
}

function makeTexture(canvas: HTMLCanvasElement, colorSpace?: THREE.ColorSpace) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  if (colorSpace) texture.colorSpace = colorSpace
  texture.needsUpdate = true
  return texture
}

function lighten(hex: string, amount: number) {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amount)
}

function darken(hex: string, amount: number) {
  return new THREE.Color(hex).lerp(new THREE.Color('#000000'), amount)
}

function addCraterField(height: number, x: number, y: number, z: number, seed: number, planetRadius: number) {
  let craterDelta = 0
  const craterCount = Math.max(8, Math.round(planetRadius * 12))
  const random = seededRandom(seed ^ 0x8f123bb)

  for (let index = 0; index < craterCount; index += 1) {
    const theta = random() * Math.PI * 2
    const phi = Math.acos(2 * random() - 1)
    const cx = Math.sin(phi) * Math.cos(theta)
    const cy = Math.cos(phi)
    const cz = Math.sin(phi) * Math.sin(theta)
    const craterRadius = 0.06 + random() * 0.1
    const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)

    if (distance < craterRadius) {
      const falloff = 1 - distance / craterRadius
      craterDelta -= falloff * falloff * 0.28
    }
  }

  return height + craterDelta
}

function localTemperatureAt(planet: Planet, x: number, y: number) {
  const latitudeBlend = Math.pow(Math.abs(y), 1.45)
  const latitudeTemperature = lerp(planet.temperature.equator, planet.temperature.pole, latitudeBlend)
  const darksideBlend = THREE.MathUtils.clamp((1 - x) * 0.5, 0, 1)
  const longitudeTemperature = lerp(planet.temperature.substellar, planet.temperature.antistellar, darksideBlend)
  const longitudeMean = (planet.temperature.substellar + planet.temperature.antistellar) * 0.5
  const longitudeWeight = planet.tidallyLocked ? 0.78 : 0.16
  return latitudeTemperature + (longitudeTemperature - longitudeMean) * longitudeWeight
}

type TerrainNoise = {
  continental: number
  detailNoise: number
  ridged: number
  stormNoise: number
  baseHeight: number
}

function sampleTerrainNoise(seed: number, x: number, y: number, z: number): TerrainNoise {
  const continental = fbm3D(x * 2.4 + 12.7, y * 2.4 - 8.5, z * 2.4 + 2.2, seed, 5)
  const detailNoise = fbm3D(x * 8.2 + 3.1, y * 8.2 + 6.3, z * 8.2 - 1.5, seed ^ 0xa7f3b2, 4)
  const ridged = ridged3D(x * 5.5 - 2.5, y * 5.5 + 9.8, z * 5.5 + 4.3, seed ^ 0x3c6ef372, 4)
  const stormNoise = fbm3D(x * 13.5, y * 2.2, z * 13.5, seed ^ 0x71bcd48, 3)
  return {
    continental,
    detailNoise,
    ridged,
    stormNoise,
    baseHeight: continental * 0.55 + detailNoise * 0.25 + ridged * 0.2,
  }
}

const seaLevelCache = new Map<string, number>()

function resolveSeaLevel(planet: Planet, archetype: PlanetArchetype, seed: number) {
  if (archetype !== 'oceanic') return archetype === 'terrestrial-ocean' ? 0.53 : 0.42

  const targetLandFraction = THREE.MathUtils.clamp(planet.landFraction ?? 0.04, 0, 0.07)
  if (targetLandFraction <= 0) return 1.01

  const cacheKey = `${seed}:${targetLandFraction.toFixed(4)}`
  const cached = seaLevelCache.get(cacheKey)
  if (cached !== undefined) return cached

  // Sample the seeded sphere and choose the height percentile that leaves the
  // requested fraction exposed. This makes ocean coverage stable for every
  // client without storing a generated texture in the backend.
  const sampleCount = 1536
  const heights = new Array<number>(sampleCount)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < sampleCount; index += 1) {
    const y = 1 - ((index + 0.5) / sampleCount) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const longitude = index * goldenAngle
    const x = Math.cos(longitude) * radius
    const z = Math.sin(longitude) * radius
    heights[index] = sampleTerrainNoise(seed, x, y, z).baseHeight
  }

  heights.sort((a, b) => a - b)
  const thresholdIndex = Math.min(
    sampleCount - 1,
    Math.max(0, Math.floor((1 - targetLandFraction) * sampleCount)),
  )
  const seaLevel = heights[thresholdIndex]
  seaLevelCache.set(cacheKey, seaLevel)
  return seaLevel
}

function evaluateSurfaceShape(planet: Planet, archetype: PlanetArchetype, seed: number, x: number, y: number, z: number): SurfaceShape {
  const { continental, detailNoise, ridged, stormNoise, baseHeight } = sampleTerrainNoise(seed, x, y, z)
  const latitudeMask = 1 - Math.abs(y)
  const polarMask = smoothstep(0.56, 0.9, Math.abs(y))
  let heightValue = baseHeight
  let isOcean = false
  let altitude = 0
  let mountainFactor = 0
  let lavaFactor = 0
  let iceFactor = 0

  if (archetype === 'gas-giant' || archetype === 'ice-giant') {
    const latitude = Math.asin(y)
    const band = 0.5 + 0.5 * Math.sin(latitude * 18 + detailNoise * 6 + stormNoise * 8)
    const swirl = fbm3D(x * 7.5, y * 1.3 + band * 0.4, z * 7.5, seed ^ 0x1234abcd, 4)
    heightValue = 0.3 + band * 0.08 + swirl * 0.08
  } else if (archetype === 'volcanic') {
    lavaFactor = smoothstep(0.74, 0.88, detailNoise * 0.55 + ridged * 0.65)
    heightValue = addCraterField(heightValue, x, y, z, seed, planet.radius)
    mountainFactor = smoothstep(0.66, 0.88, ridged * 0.7 + heightValue * 0.3)
  } else if (archetype === 'desert') {
    heightValue = addCraterField(heightValue * 1.12, x, y, z, seed, planet.radius)
    mountainFactor = smoothstep(0.65, 0.88, ridged * 0.72 + heightValue * 0.28)
  } else if (archetype === 'icy') {
    heightValue = 0.42 + ridged * 0.3 + detailNoise * 0.18
    mountainFactor = smoothstep(0.68, 0.9, ridged)
  } else {
    const seaLevel = resolveSeaLevel(planet, archetype, seed)
    isOcean = heightValue < seaLevel
    if (isOcean) {
      heightValue = seaLevel * 0.82 + heightValue * 0.18
    } else {
      altitude = THREE.MathUtils.clamp((heightValue - seaLevel) / (1 - seaLevel), 0, 1)
      mountainFactor = smoothstep(0.5, 0.82, altitude * 0.68 + ridged * 0.42)
      heightValue += ridged * 0.18 + altitude * 0.12
    }
  }

  const localTemperature = localTemperatureAt(planet, x, y)
  const profileMaximum = Math.max(
    planet.temperature.pole,
    planet.temperature.equator,
    planet.temperature.substellar,
    planet.temperature.antistellar,
  )
  const globallyFrozenProfile = profileMaximum < 0
  const deepFreezeStrength = globallyFrozenProfile
    ? 0.82 + THREE.MathUtils.clamp((-profileMaximum) / 55, 0, 1) * 0.18
    : 0

  if (archetype === 'icy') {
    iceFactor = 1
  } else if (
    archetype !== 'volcanic'
    && archetype !== 'gas-giant'
    && archetype !== 'ice-giant'
    && localTemperature < 7
  ) {
    const coldness = THREE.MathUtils.clamp((7 - localTemperature) / 64, 0, 1)
    const capNoise = fbm3D(x * 5.8 + 4.1, y * 5.8 - 2.7, z * 5.8 + 8.3, seed ^ 0x51f15e, 4)
    const irregularLatitude = Math.abs(y)
      + (detailNoise - 0.5) * 0.075
      + (ridged - 0.5) * 0.04
      + (capNoise - 0.5) * 0.065
    const landBias = isOcean ? -0.1 : 0.045 + altitude * 0.045
    const iceLine = 0.95 - coldness * 0.38
    const polarCoverage = smoothstep(iceLine, iceLine + 0.07, irregularLatitude + landBias)

    // Permanently shadowed terrain on synchronously rotating worlds can freeze
    // well beyond the poles. In climate/texture coordinates +X is substellar
    // and -X is antistellar. SphereGeometry mirrors that longitude visually;
    // tidalOrientation.ts is the single source of truth for that mapping.
    const darksideBlend = THREE.MathUtils.clamp((1 - x) * 0.5, 0, 1)
    const terminatorNoise = (capNoise - 0.5) * 0.11 + (detailNoise - 0.5) * 0.055
    const nightCoverage = planet.tidallyLocked
      ? smoothstep(0.39 + terminatorNoise, 0.59 + terminatorNoise, darksideBlend)
      : 0
    const nightColdness = THREE.MathUtils.clamp((3 - localTemperature) / 78, 0, 1)

    if (isOcean) {
      // Sea ice is normally fragmented and less extensive than continental ice.
      // If every authoritative climate anchor is below freezing, however, the
      // ocean becomes a near-global ice shell with only deterministic leads.
      const polarOceanFreeze = THREE.MathUtils.clamp((-12 - localTemperature) / 62, 0, 1)
      const nightOceanFreeze = THREE.MathUtils.clamp((-12 - localTemperature) / 78, 0, 1)
      const brokenSeaIce = smoothstep(0.46, 0.78, capNoise * 0.66 + detailNoise * 0.34)
      const polarSeaIce = polarCoverage * polarOceanFreeze * (0.05 + brokenSeaIce * 0.16)
      const nightSeaIce = nightCoverage * nightOceanFreeze * (0.2 + brokenSeaIce * 0.58)
      const globalSeaIce = globallyFrozenProfile
        ? deepFreezeStrength * (0.9 + brokenSeaIce * 0.1)
        : 0
      iceFactor = Math.max(polarSeaIce, nightSeaIce, globalSeaIce)
    } else {
      const terrainCoverage = 0.82 + smoothstep(0.28, 0.8, continental) * 0.18
      const polarLandIce = polarCoverage * coldness * terrainCoverage
      const nightLandIce = nightCoverage
        * smoothstep(0.08, 0.48, nightColdness)
        * (0.84 + terrainCoverage * 0.16)
      const globalLandIce = globallyFrozenProfile
        ? deepFreezeStrength * (0.94 + terrainCoverage * 0.06)
        : 0
      iceFactor = Math.max(polarLandIce, nightLandIce, globalLandIce)
    }
  }

  return {
    heightValue: THREE.MathUtils.clamp(heightValue, 0, 1),
    isOcean,
    altitude,
    mountainFactor,
    lavaFactor,
    detailNoise,
    ridged,
    stormNoise,
    latitudeMask,
    polarMask,
    iceFactor,
    localTemperature,
  }
}

function isUrbanizable(archetype: PlanetArchetype, shape: SurfaceShape) {
  if (archetype === 'gas-giant' || archetype === 'ice-giant' || archetype === 'icy') return false
  if (shape.isOcean || shape.mountainFactor > 0.48 || shape.lavaFactor > 0.18 || shape.iceFactor > 0.22) return false
  return true
}

function buildUrbanClusters(planet: Planet, archetype: PlanetArchetype, seed: number) {
  if (planet.population < 1000 || archetype === 'gas-giant' || archetype === 'ice-giant') return []

  const populationScale = THREE.MathUtils.clamp((Math.log10(Math.max(planet.population, 1)) - 4) / 6.2, 0, 1)
  const desiredClusters = Math.max(1, Math.round(1 + populationScale * 14))
  const random = seededRandom(seed ^ 0x93a7d15)
  const clusters: UrbanCluster[] = []
  let attempts = 0

  while (clusters.length < desiredClusters && attempts < desiredClusters * 80) {
    attempts += 1
    const longitude = random() * Math.PI * 2
    const latitude = Math.asin(random() * 1.7 - 0.85)
    const cosLat = Math.cos(latitude)
    const x = cosLat * Math.cos(longitude)
    const y = Math.sin(latitude)
    const z = cosLat * Math.sin(longitude)
    const shape = evaluateSurfaceShape(planet, archetype, seed, x, y, z)
    if (!isUrbanizable(archetype, shape)) continue

    const angularRadius = THREE.MathUtils.lerp(0.035, 0.14, populationScale) * (0.65 + random() * 0.75)
    const chordRadius = 2 * Math.sin(angularRadius / 2)
    clusters.push({
      x,
      y,
      z,
      radiusSquared: chordRadius * chordRadius,
      density: 0.65 + random() * 0.55,
      warmth: random(),
    })
  }

  return clusters
}

function urbanInfluenceAt(x: number, y: number, z: number, clusters: UrbanCluster[]) {
  let influence = 0
  let warmth = 0.5

  for (const cluster of clusters) {
    const dx = x - cluster.x
    const dy = y - cluster.y
    const dz = z - cluster.z
    const distanceSquared = dx * dx + dy * dy + dz * dz
    if (distanceSquared >= cluster.radiusSquared) continue
    const local = 1 - distanceSquared / cluster.radiusSquared
    const weighted = local * local * cluster.density
    if (weighted > influence) {
      influence = weighted
      warmth = cluster.warmth
    }
  }

  return { influence: THREE.MathUtils.clamp(influence, 0, 1), warmth }
}

function seedForPlanet(planet: Planet, seedKey: string) {
  return hashSeed(`${seedKey}:${planet.id}:${planet.type}`)
}

export function samplePlanetSurfaceInfo(
  planet: Planet,
  seedKey: string,
  latitudeDegrees: number,
  longitudeDegrees: number,
  baseRadius: number,
) {
  const latitude = THREE.MathUtils.degToRad(latitudeDegrees)
  const longitude = THREE.MathUtils.degToRad(longitudeDegrees)
  const cosLat = Math.cos(latitude)
  // SphereGeometry mirrors the procedural longitude on X, so sample in texture space.
  const x = -cosLat * Math.cos(longitude)
  const y = Math.sin(latitude)
  const z = -cosLat * Math.sin(longitude)
  const archetype = describePlanetArchetype(planet)
  const shape = evaluateSurfaceShape(planet, archetype, seedForPlanet(planet, seedKey), x, y, z)
  const displacementScale = archetype === 'gas-giant' || archetype === 'ice-giant' ? 0 : planet.radius * 0.22
  return {
    radius: baseRadius + shape.heightValue * displacementScale,
    isOcean: shape.isOcean,
    mountainFactor: shape.mountainFactor,
    lavaFactor: shape.lavaFactor,
    archetype,
  }
}

export function samplePlanetSurfaceRadius(
  planet: Planet,
  seedKey: string,
  latitudeDegrees: number,
  longitudeDegrees: number,
  baseRadius: number,
) {
  return samplePlanetSurfaceInfo(planet, seedKey, latitudeDegrees, longitudeDegrees, baseRadius).radius
}


export function buildUrbanLightSites(planet: Planet, seedKey: string, baseRadius: number) {
  const archetype = describePlanetArchetype(planet)
  const seed = seedForPlanet(planet, seedKey)
  const clusters = buildUrbanClusters(planet, archetype, seed)
  const populationScale = THREE.MathUtils.clamp((Math.log10(Math.max(planet.population, 1)) - 4) / 6.2, 0, 1)
  const displacementScale = archetype === 'gas-giant' || archetype === 'ice-giant' ? 0 : planet.radius * 0.22

  return clusters
    .slice()
    .sort((a, b) => b.density - a.density)
    .slice(0, Math.min(3, Math.max(1, Math.round(populationScale * 3))))
    .map((cluster, index) => {
      const shape = evaluateSurfaceShape(planet, archetype, seed, cluster.x, cluster.y, cluster.z)
      const radius = baseRadius + shape.heightValue * displacementScale + baseRadius * 0.012
      const direction = new THREE.Vector3(-cluster.x, cluster.y, cluster.z).normalize()
      return {
        id: `${planet.id}-urban-light-${index}`,
        position: direction.multiplyScalar(radius).toArray() as [number, number, number],
        color: cluster.warmth > 0.55 ? '#78dcff' : '#ffae58',
        intensity: 0.08 + populationScale * 0.24,
        distance: baseRadius * (0.18 + populationScale * 0.1),
      }
    })
}

function createPlanetMaps(planet: Planet, seedKey: string, detail: DetailLevel): PlanetMaps {
  const seed = seedForPlanet(planet, seedKey)
  const archetype = describePlanetArchetype(planet)
  // Use the same procedural recipe in both views. The system view keeps a
  // smaller texture for performance, but is high enough that coastlines, ice,
  // gas bands, cities, and lava fields retain the same visual identity.
  const size = detail === 'detail' ? 1024 : 640
  const colorCanvas = buildCanvas(size)
  const bumpCanvas = buildCanvas(size)
  const roughnessCanvas = buildCanvas(size)
  const emissiveCanvas = buildCanvas(size)
  const cloudCanvas = buildCanvas(size)
  const contexts = [colorCanvas, bumpCanvas, roughnessCanvas, emissiveCanvas, cloudCanvas].map((canvas) => canvas.getContext('2d')!)
  const [colorContext, bumpContext, roughContext, emissiveContext, cloudContext] = contexts
  const colorImage = colorContext.createImageData(colorCanvas.width, colorCanvas.height)
  const bumpImage = bumpContext.createImageData(bumpCanvas.width, bumpCanvas.height)
  const roughImage = roughContext.createImageData(roughnessCanvas.width, roughnessCanvas.height)
  const emissiveImage = emissiveContext.createImageData(emissiveCanvas.width, emissiveCanvas.height)
  const cloudImage = cloudContext.createImageData(cloudCanvas.width, cloudCanvas.height)

  const baseColor = new THREE.Color(planet.color)
  const accentColor = new THREE.Color(planet.secondaryColor)
  const waterColor = new THREE.Color('#2f7bd2')
  const shallowWaterColor = new THREE.Color('#5eb3ea')
  const polarColor = new THREE.Color('#eff7ff')
  const sandColor = new THREE.Color('#cda978')
  const volcanicColor = new THREE.Color('#281513')
  const volcanicGlow = new THREE.Color('#ff7a2a')
  const iceColor = new THREE.Color('#a9deeb')
  const gasLight = lighten(planet.secondaryColor, 0.35)
  const gasDark = darken(planet.color, 0.28)
  const cityDark = new THREE.Color('#090d12')
  const warmLights = new THREE.Color('#ffb257')
  const coolLights = new THREE.Color('#75dfff')
  const atmosphereColor = atmosphereColorFor(planet)
  const urbanClusters = buildUrbanClusters(planet, archetype, seed)
  const populationScale = THREE.MathUtils.clamp((Math.log10(Math.max(planet.population, 1)) - 4) / 6.2, 0, 1)
  const width = colorCanvas.width
  const height = colorCanvas.height
  const cloudDensitySeed = seed ^ 0x5ee29a01
  const cityNetworkSeed = seed ^ 0x4d36ab2
  const cityLightSeed = seed ^ 0x781a2f9
  const cloudOpacity = archetype === 'gas-giant' || archetype === 'ice-giant' ? 0 : archetype === 'oceanic' || archetype === 'terrestrial-ocean' ? 0.48 : 0.2

  for (let py = 0; py < height; py += 1) {
    const v = py / height
    const latitude = (0.5 - v) * Math.PI
    const sinLat = Math.sin(latitude)
    const cosLat = Math.cos(latitude)

    for (let px = 0; px < width; px += 1) {
      const u = px / width
      const longitude = u * Math.PI * 2
      const x = cosLat * Math.cos(longitude)
      const y = sinLat
      const z = cosLat * Math.sin(longitude)
      const shape = evaluateSurfaceShape(planet, archetype, seed, x, y, z)
      let surfaceColor = baseColor.clone()
      let roughnessValue = 0.75
      let volcanicEmission = 0
      let cloudAlpha = 0

      if (archetype === 'gas-giant' || archetype === 'ice-giant') {
        const band = 0.5 + 0.5 * Math.sin(latitude * 18 + shape.detailNoise * 6 + shape.stormNoise * 8)
        const swirl = fbm3D(x * 7.5, y * 1.3 + band * 0.4, z * 7.5, seed ^ 0x1234abcd, 4)
        surfaceColor = gasDark.clone().lerp(gasLight, THREE.MathUtils.clamp(band * 0.72 + swirl * 0.42, 0, 1))
        if (archetype === 'ice-giant') surfaceColor.lerp(iceColor, 0.38)
        roughnessValue = 0.52
      } else if (archetype === 'volcanic') {
        surfaceColor = volcanicColor.clone().lerp(accentColor, shape.ridged * 0.55).lerp(volcanicGlow, shape.lavaFactor * 0.78)
        roughnessValue = 0.92 - shape.lavaFactor * 0.38
        volcanicEmission = shape.lavaFactor
      } else if (archetype === 'desert') {
        surfaceColor = sandColor.clone().lerp(baseColor, shape.detailNoise * 0.35).lerp(accentColor, shape.ridged * 0.25)
        roughnessValue = 0.88
      } else if (archetype === 'icy') {
        surfaceColor = iceColor.clone().lerp(accentColor, shape.detailNoise * 0.22).lerp(polarColor, shape.polarMask * 0.5)
        roughnessValue = 0.82
      } else if (shape.isOcean) {
        const seaLevel = resolveSeaLevel(planet, archetype, seed)
        const oceanDepth = THREE.MathUtils.clamp((seaLevel - shape.heightValue) / seaLevel, 0, 1)
        surfaceColor = waterColor.clone().lerp(shallowWaterColor, 1 - oceanDepth)
        roughnessValue = 0.16 + oceanDepth * 0.08
      } else {
        const vegetation = THREE.MathUtils.clamp(shape.latitudeMask * 0.85 + shape.detailNoise * 0.18, 0, 1)
        const lowland = new THREE.Color('#3a8c58')
        const highland = new THREE.Color('#8a7458')
        const mountain = new THREE.Color('#d6d0c6')
        surfaceColor = lowland
          .clone()
          .lerp(highland, shape.altitude * 0.65 + (1 - vegetation) * 0.22)
          .lerp(mountain, smoothstep(0.58, 1, shape.altitude))
          .lerp(baseColor, 0.2)
        roughnessValue = 0.88
      }

      if (shape.iceFactor > 0 && archetype !== 'volcanic') {
        const iceTint = polarColor.clone().lerp(iceColor, shape.isOcean ? 0.28 : 0.08)
        const globallyFrozen = Math.max(
          planet.temperature.pole,
          planet.temperature.equator,
          planet.temperature.substellar,
          planet.temperature.antistellar,
        ) < 0
        const visibleIce = shape.isOcean
          ? shape.iceFactor * (globallyFrozen ? 0.96 : 0.72)
          : shape.iceFactor * 0.97
        surfaceColor.lerp(iceTint, visibleIce)
        roughnessValue = lerp(roughnessValue, shape.isOcean ? 0.36 : 0.72, visibleIce)
      }

      let cityLightStrength = 0
      let cityLightColor = warmLights
      if (urbanClusters.length > 0 && isUrbanizable(archetype, shape)) {
        const urban = urbanInfluenceAt(x, y, z, urbanClusters)
        if (urban.influence > 0.002) {
          const organicRoads = ridged3D(x * 41 + 3.7, y * 41 - 8.2, z * 41 + 1.9, cityNetworkSeed, 3)
          const secondaryRoads = ridged3D(x * 73 - 4.1, y * 73 + 2.8, z * 73 + 9.4, cityNetworkSeed ^ 0x7812, 2)
          const roadMask = THREE.MathUtils.clamp(
            smoothstep(0.7, 0.93, organicRoads) * 0.82 + smoothstep(0.78, 0.96, secondaryRoads) * 0.45,
            0,
            1,
          )
          const blockNoise = valueNoise3D(x * 126, y * 126, z * 126, cityLightSeed)
          const urbanMask = urban.influence * smoothstep(0.12, 0.82, roadMask + blockNoise * 0.36)
          surfaceColor.lerp(cityDark, urbanMask * (0.5 + populationScale * 0.34))
          roughnessValue = lerp(roughnessValue, 0.62, urbanMask * 0.65)
          cityLightStrength = urban.influence
            * smoothstep(0.66, 0.92, roadMask)
            * smoothstep(0.67, 0.94, blockNoise)
            * (0.16 + populationScale * 0.48)
          cityLightColor = warmLights.clone().lerp(coolLights, urban.warmth * 0.36)
        }
      }

      if (archetype !== 'gas-giant' && archetype !== 'ice-giant') {
        const cloudField = fbm3D(x * 7.5 + 10, y * 7.5 - 6, z * 7.5 + 2, cloudDensitySeed, 5)
        cloudAlpha = smoothstep(0.6, 0.76, cloudField + shape.latitudeMask * 0.16)
      }

      surfaceColor.multiplyScalar(0.9 + shape.latitudeMask * 0.15)
      const pixelIndex = (py * width + px) * 4
      colorImage.data[pixelIndex] = Math.round(THREE.MathUtils.clamp(surfaceColor.r, 0, 1) * 255)
      colorImage.data[pixelIndex + 1] = Math.round(THREE.MathUtils.clamp(surfaceColor.g, 0, 1) * 255)
      colorImage.data[pixelIndex + 2] = Math.round(THREE.MathUtils.clamp(surfaceColor.b, 0, 1) * 255)
      colorImage.data[pixelIndex + 3] = 255

      const heightByte = Math.round(shape.heightValue * 255)
      bumpImage.data[pixelIndex] = heightByte
      bumpImage.data[pixelIndex + 1] = heightByte
      bumpImage.data[pixelIndex + 2] = heightByte
      bumpImage.data[pixelIndex + 3] = 255

      const roughByte = Math.round(THREE.MathUtils.clamp(roughnessValue, 0, 1) * 255)
      roughImage.data[pixelIndex] = roughByte
      roughImage.data[pixelIndex + 1] = roughByte
      roughImage.data[pixelIndex + 2] = roughByte
      roughImage.data[pixelIndex + 3] = 255

      const volcanicLight = volcanicGlow.clone().multiplyScalar(volcanicEmission)
      const cityLight = cityLightColor.clone().multiplyScalar(cityLightStrength)
      const emission = volcanicLight.add(cityLight)
      emissiveImage.data[pixelIndex] = Math.round(THREE.MathUtils.clamp(emission.r, 0, 1) * 255)
      emissiveImage.data[pixelIndex + 1] = Math.round(THREE.MathUtils.clamp(emission.g, 0, 1) * 255)
      emissiveImage.data[pixelIndex + 2] = Math.round(THREE.MathUtils.clamp(emission.b, 0, 1) * 255)
      emissiveImage.data[pixelIndex + 3] = Math.round(THREE.MathUtils.clamp(Math.max(volcanicEmission, cityLightStrength), 0, 1) * 255)

      const cloudByte = Math.round(THREE.MathUtils.clamp(cloudAlpha, 0, 1) * 255)
      cloudImage.data[pixelIndex] = 255
      cloudImage.data[pixelIndex + 1] = 255
      cloudImage.data[pixelIndex + 2] = 255
      cloudImage.data[pixelIndex + 3] = cloudByte
    }
  }

  colorContext.putImageData(colorImage, 0, 0)
  bumpContext.putImageData(bumpImage, 0, 0)
  roughContext.putImageData(roughImage, 0, 0)
  emissiveContext.putImageData(emissiveImage, 0, 0)
  cloudContext.putImageData(cloudImage, 0, 0)

  return {
    colorMap: makeTexture(colorCanvas, THREE.SRGBColorSpace),
    bumpMap: makeTexture(bumpCanvas),
    roughnessMap: makeTexture(roughnessCanvas),
    emissiveMap: makeTexture(emissiveCanvas, THREE.SRGBColorSpace),
    alphaCloudMap: makeTexture(cloudCanvas),
    atmosphereColor: archetype === 'gas-giant' ? undefined : atmosphereColor,
    cloudOpacity,
    displacementScale: archetype !== 'gas-giant' && archetype !== 'ice-giant'
      ? planet.radius * (detail === 'detail' ? 0.22 : 0.035)
      : 0,
    bumpScale: detail === 'detail' ? planet.radius * 0.12 : planet.radius * 0.08,
  }
}

export function ProceduralPlanet({ planet, seedKey, detail = 'system', radius, onClick }: {
  planet: Planet
  seedKey: string
  detail?: DetailLevel
  radius: number
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}) {
  const cached = useMemo(
    () => getCachedPlanetMaps(planet, seedKey, detail),
    [detail, planet, seedKey],
  )
  const maps = cached.entry.maps

  useEffect(() => {
    cached.entry.users += 1
    cached.entry.lastUsed = performance.now()
    return () => {
      cached.entry.users = Math.max(0, cached.entry.users - 1)
      cached.entry.lastUsed = performance.now()
      schedulePlanetMapCacheTrim()
    }
  }, [cached])

  const segmentCount = detail === 'detail' ? 164 : 96

  return (
    <group>
      <mesh onClick={onClick} castShadow receiveShadow>
        <sphereGeometry args={[radius, segmentCount, segmentCount]} />
        <meshStandardMaterial
          map={maps.colorMap}
          bumpMap={maps.bumpMap}
          bumpScale={maps.bumpScale}
          displacementMap={maps.displacementScale > 0 ? maps.bumpMap : undefined}
          displacementScale={maps.displacementScale}
          roughnessMap={maps.roughnessMap}
          roughness={0.95}
          metalness={0.05}
          emissiveMap={maps.emissiveMap}
          emissive="#ffffff"
          emissiveIntensity={1.12}
          fog={detail === 'detail'}
        />
      </mesh>

      {maps.cloudOpacity > 0.02 && (
        <mesh>
          <sphereGeometry args={[radius * 1.018, 64, 64]} />
          <meshStandardMaterial
            alphaMap={maps.alphaCloudMap}
            transparent
            opacity={maps.cloudOpacity}
            color="#ffffff"
            depthWrite={false}
            roughness={0.92}
            fog={detail === 'detail'}
          />
        </mesh>
      )}

      {maps.atmosphereColor && planet.atmosphere.toLowerCase() !== 'none' && (
        <mesh>
          <sphereGeometry args={[radius * 1.055, 64, 64]} />
          <meshBasicMaterial
            color={maps.atmosphereColor}
            transparent
            opacity={detail === 'detail' ? 0.16 : 0.13}
            side={THREE.BackSide}
            fog={detail === 'detail'}
          />
        </mesh>
      )}
    </group>
  )
}

export function PlanetRings({ planet, radius, detail = 'detail' }: { planet: Planet; radius: number; detail?: DetailLevel }) {
  if (!planet.ringColor) return null

  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 1.48, radius * 2.38, 192]} />
        <meshStandardMaterial
          color={planet.ringColor}
          transparent
          opacity={0.5}
          roughness={0.86}
          metalness={0.04}
          side={THREE.DoubleSide}
          depthWrite={false}
          fog={detail === 'detail'}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 1.78, radius * 1.9, 192]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.11}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
          fog={detail === 'detail'}
        />
      </mesh>
    </group>
  )
}

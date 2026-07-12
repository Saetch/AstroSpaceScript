import * as THREE from 'three'
import type { Galaxy, GalaxyCompanion, GalaxyMorphology, Vector3Tuple } from '../domain/universe'

export interface GalaxyBodyDefinition {
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
  primary: boolean
  interactionTarget?: Vector3Tuple
  interactionPhase?: 'bound' | 'close-pass' | 'merging'
  distortion?: number
  bridgeStrength?: number
  tailStrength?: number
}

export interface GalaxyGeometryOptions {
  count: number
  radius?: number
  thickness?: number
  colorTransform?: (color: THREE.Color, x: number, y: number, z: number) => THREE.Color
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function gaussianLike(random: () => number, samples = 5) {
  let total = 0
  for (let index = 0; index < samples; index += 1) total += random()
  return total - samples / 2
}

function rotateVectorIntoBodySpace(vector: Vector3Tuple, rotation: number): Vector3Tuple {
  const cosine = Math.cos(-rotation)
  const sine = Math.sin(-rotation)
  return [
    vector[0] * cosine - vector[2] * sine,
    vector[1],
    vector[0] * sine + vector[2] * cosine,
  ]
}

export function getGalaxyBodies(galaxy: Galaxy): GalaxyBodyDefinition[] {
  const interactingCompanions = (galaxy.companions ?? [])
    .filter((companion) => companion.interaction && companion.interaction.phase !== 'bound')
    .sort((a, b) => (b.interaction?.distortion ?? 0) - (a.interaction?.distortion ?? 0))
  const dominantInteraction = interactingCompanions[0]

  const primary: GalaxyBodyDefinition = {
    id: galaxy.id,
    name: galaxy.name,
    offset: [0, 0, 0],
    radius: galaxy.radius,
    thickness: galaxy.thickness,
    rotation: 0,
    inclination: galaxy.inclination ?? [0, 0, 0],
    morphology: galaxy.morphology,
    primaryColor: galaxy.primaryColor,
    secondaryColor: galaxy.secondaryColor,
    seed: galaxy.seed,
    armCount: galaxy.armCount,
    armWinding: galaxy.armWinding,
    barLength: galaxy.barLength,
    primary: true,
    interactionTarget: dominantInteraction?.offset,
    interactionPhase: dominantInteraction?.interaction?.phase,
    distortion: dominantInteraction ? (dominantInteraction.interaction?.distortion ?? 0) * 0.86 : undefined,
    bridgeStrength: dominantInteraction?.interaction?.bridgeStrength,
    tailStrength: dominantInteraction ? (dominantInteraction.interaction?.tailStrength ?? 0) * 0.9 : undefined,
  }

  const companions = (galaxy.companions ?? []).map((companion: GalaxyCompanion): GalaxyBodyDefinition => ({
    ...companion,
    primary: false,
    interactionTarget: companion.interaction
      ? rotateVectorIntoBodySpace([-companion.offset[0], -companion.offset[1], -companion.offset[2]], companion.rotation)
      : undefined,
    interactionPhase: companion.interaction?.phase,
    distortion: companion.interaction?.distortion,
    bridgeStrength: companion.interaction?.bridgeStrength,
    tailStrength: companion.interaction?.tailStrength,
  }))

  return [primary, ...companions]
}

export function buildGalaxyPointGeometry(body: GalaxyBodyDefinition, options: GalaxyGeometryOptions) {
  const radius = options.radius ?? body.radius
  const thickness = options.thickness ?? body.thickness
  const positions = new Float32Array(options.count * 3)
  const colors = new Float32Array(options.count * 3)
  const random = seededRandom(body.seed)
  const primary = new THREE.Color(body.primaryColor)
  const secondary = new THREE.Color(body.secondaryColor)

  const place = (index: number, sourceX: number, sourceY: number, sourceZ: number, brightness: number) => {
    let x = sourceX
    let y = sourceY
    let z = sourceZ

    if (body.interactionTarget && body.interactionPhase && body.interactionPhase !== 'bound') {
      const target = new THREE.Vector3(...body.interactionTarget)
      target.y = 0
      if (target.lengthSq() > 0.0001) {
        target.normalize()
        const perpendicular = new THREE.Vector3(-target.z, 0, target.x)
        const radialDistance = Math.hypot(x, z)
        const normalizedRadius = THREE.MathUtils.clamp(radialDistance / Math.max(0.0001, radius), 0, 1.35)
        const radialDirection = radialDistance > 0.0001
          ? new THREE.Vector3(x / radialDistance, 0, z / radialDistance)
          : target.clone()
        const facing = radialDirection.dot(target)
        const nearSide = THREE.MathUtils.smoothstep(facing, -0.18, 0.9)
        const farSide = THREE.MathUtils.smoothstep(-facing, 0.12, 0.92)
        const outerDisk = THREE.MathUtils.smoothstep(normalizedRadius, 0.34, 1.0)
        const phaseMultiplier = body.interactionPhase === 'merging' ? 1 : 0.72
        const distortion = THREE.MathUtils.clamp(body.distortion ?? 0, 0, 1) * phaseMultiplier
        const tailStrength = THREE.MathUtils.clamp(body.tailStrength ?? 0, 0, 1) * phaseMultiplier

        // Preserve a recognizable core and inner spiral, but turn the outer disc into
        // a teardrop that is visibly pulled toward the partner. The far side becomes
        // a broad, curved tidal fan rather than a narrow particle rope.
        const along = x * target.x + z * target.z
        const across = x * perpendicular.x + z * perpendicular.z
        const nearPull = radius * distortion * outerDisk * outerDisk * nearSide * 0.19
        const farExtension = radius * tailStrength * outerDisk * outerDisk * farSide * 0.3
        const fanCurve = radius * tailStrength * outerDisk * outerDisk * farSide * 0.14
          * (Math.sign(across) || 1)
        const nearCompression = 1 - distortion * outerDisk * nearSide * 0.06
        const farSpread = 1 + tailStrength * outerDisk * farSide * 0.12

        x = target.x * (along + nearPull - farExtension)
          + perpendicular.x * (across * nearCompression * farSpread + fanCurve)
        z = target.z * (along + nearPull - farExtension)
          + perpendicular.z * (across * nearCompression * farSpread + fanCurve)
        y *= 1 - THREE.MathUtils.clamp(distortion * outerDisk * 0.16, 0, 0.28)
      }
    }

    let color = primary.clone().lerp(secondary, random() * 0.72).multiplyScalar(brightness)
    if (options.colorTransform) color = options.colorTransform(color, x, y, z)

    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z
    colors[index * 3] = THREE.MathUtils.clamp(color.r, 0, 1)
    colors[index * 3 + 1] = THREE.MathUtils.clamp(color.g, 0, 1)
    colors[index * 3 + 2] = THREE.MathUtils.clamp(color.b, 0, 1)
  }

  for (let index = 0; index < options.count; index += 1) {
    if (body.morphology === 'elliptical') {
      const radial = Math.pow(random(), 1.8) * radius
      const theta = random() * Math.PI * 2
      const vertical = (random() - 0.5) * thickness * (1 - radial / radius * 0.45)
      place(index, Math.cos(theta) * radial, vertical, Math.sin(theta) * radial * 0.78, 0.62 + random() * 0.42)
      continue
    }

    if (body.morphology === 'irregular') {
      const clumpCount = 5
      const clump = index % clumpCount
      const clumpAngle = clump * 1.33 + random() * 0.4
      const clumpDistance = radius * (0.12 + clump * 0.12)
      const spread = radius * (0.18 + random() * 0.16)
      place(
        index,
        Math.cos(clumpAngle) * clumpDistance + (random() - 0.5) * spread,
        (random() - 0.5) * thickness,
        Math.sin(clumpAngle) * clumpDistance + (random() - 0.5) * spread,
        0.5 + random() * 0.46,
      )
      continue
    }

    if (body.morphology === 'barred-spiral') {
      const component = random()
      const barHalfLength = radius * THREE.MathUtils.clamp(body.barLength ?? 0.29, 0.18, 0.42)
      const winding = body.armWinding ?? 0.68

      if (component < 0.18) {
        const radial = Math.pow(random(), 2.1) * radius * 0.19
        const angle = random() * Math.PI * 2
        place(
          index,
          Math.cos(angle) * radial,
          (random() - 0.5) * thickness * 0.4,
          Math.sin(angle) * radial * 0.7,
          0.82 + random() * 0.34,
        )
        continue
      }

      if (component < 0.43) {
        const along = (random() * 2 - 1) * barHalfLength
        const normalized = Math.abs(along) / Math.max(0.0001, barHalfLength)
        const width = radius * (0.02 + (1 - normalized) * 0.036)
        const cross = gaussianLike(random) * width
        place(
          index,
          along,
          (random() - 0.5) * thickness * (0.18 + (1 - normalized) * 0.24),
          cross,
          0.68 + (1 - normalized) * 0.26 + random() * 0.18,
        )
        continue
      }

      if (component < 0.83) {
        const arm = index % 2
        const progress = Math.pow(random(), 0.9)
        let radial = barHalfLength + progress * (radius - barHalfLength)
        let angle = arm * Math.PI + progress * Math.PI * winding
        angle += gaussianLike(random) * (0.07 + progress * 0.14)
        radial += gaussianLike(random, 4) * radius * (0.02 + progress * 0.045)

        place(
          index,
          Math.cos(angle) * radial,
          (random() - 0.5) * thickness * (0.2 + progress * 0.34),
          Math.sin(angle) * radial,
          0.54 + random() * 0.44,
        )
        continue
      }

      const diffuseRadius = Math.sqrt(random()) * radius * 0.98
      const diffuseAngle = random() * Math.PI * 2
      place(
        index,
        Math.cos(diffuseAngle) * diffuseRadius,
        (random() - 0.5) * thickness * 0.3,
        Math.sin(diffuseAngle) * diffuseRadius,
        0.26 + random() * 0.3,
      )
      continue
    }

    const component = random()
    if (component < 0.14) {
      const radial = Math.pow(random(), 2.05) * radius * 0.2
      const angle = random() * Math.PI * 2
      place(
        index,
        Math.cos(angle) * radial,
        (random() - 0.5) * thickness * 0.52,
        Math.sin(angle) * radial,
        0.76 + random() * 0.28,
      )
      continue
    }

    if (component > 0.9) {
      const radial = Math.sqrt(random()) * radius
      const angle = random() * Math.PI * 2
      place(
        index,
        Math.cos(angle) * radial,
        (random() - 0.5) * thickness * 0.35,
        Math.sin(angle) * radial,
        0.24 + random() * 0.32,
      )
      continue
    }

    const arms = Math.max(2, Math.round(body.armCount ?? 4))
    const progress = Math.pow(random(), 0.66)
    const radial = progress * radius
    const arm = index % arms
    const winding = body.armWinding ?? 1.7
    const baseAngle = arm * ((Math.PI * 2) / arms) + progress * Math.PI * winding
    const jitter = gaussianLike(random, 4) * (0.1 + progress * 0.26)
    const radialSpread = gaussianLike(random, 4) * radius * (0.008 + progress * 0.026)
    const finalRadius = radial + radialSpread

    place(
      index,
      Math.cos(baseAngle + jitter) * finalRadius,
      (random() - 0.5) * thickness * (0.22 + progress * 0.78),
      Math.sin(baseAngle + jitter) * finalRadius,
      0.5 + random() * 0.48,
    )
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function galaxyGroupExtent(galaxy: Galaxy) {
  return getGalaxyBodies(galaxy).reduce((extent, body) => {
    const centerDistance = Math.hypot(body.offset[0], body.offset[2])
    const tailMultiplier = body.interactionPhase && body.interactionPhase !== 'bound'
      ? 1.16 + (body.tailStrength ?? 0.35) * 0.34
      : 1
    return Math.max(extent, centerDistance + body.radius * tailMultiplier)
  }, galaxy.radius)
}


export interface GalaxyInteractionStream {
  id: string
  geometry: THREE.BufferGeometry
  opacity: number
  size: number
}

function createInteractionGeometry(
  count: number,
  fill: (index: number, point: THREE.Vector3) => { mix: number; brightness: number },
  primaryColor: THREE.Color,
  companionColor: THREE.Color,
) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const point = new THREE.Vector3()

  for (let index = 0; index < count; index += 1) {
    point.set(0, 0, 0)
    const { mix, brightness } = fill(index, point)
    const color = primaryColor.clone().lerp(companionColor, mix).multiplyScalar(brightness)
    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.y
    positions[index * 3 + 2] = point.z
    colors[index * 3] = THREE.MathUtils.clamp(color.r, 0, 1)
    colors[index * 3 + 1] = THREE.MathUtils.clamp(color.g, 0, 1)
    colors[index * 3 + 2] = THREE.MathUtils.clamp(color.b, 0, 1)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function buildGalaxyInteractionStreams(
  galaxy: Galaxy,
  scale = 1,
  countPerCompanion = 3200,
): GalaxyInteractionStream[] {
  const primaryColor = new THREE.Color(galaxy.primaryColor)

  return (galaxy.companions ?? [])
    .filter((companion) => companion.interaction && companion.interaction.phase !== 'bound')
    .flatMap((companion) => {
      const interaction = companion.interaction!
      const random = seededRandom(galaxy.seed ^ companion.seed ^ 0x5a17c9)
      const companionColor = new THREE.Color(companion.primaryColor)
      const companionCenter = new THREE.Vector3(...companion.offset).multiplyScalar(scale)
      const direction = companionCenter.clone().setY(0).normalize()
      const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
      const separation = Math.max(1, companionCenter.length())
      const primaryRadius = galaxy.radius * scale
      const companionRadius = companion.radius * scale
      const midpoint = companionCenter.clone().multiplyScalar(0.5)
      const maxThickness = Math.max(galaxy.thickness, companion.thickness) * scale
      const envelopeStrength = THREE.MathUtils.clamp(
        interaction.envelopeStrength ?? Math.max(0.42, interaction.bridgeStrength * 0.9),
        0,
        1,
      )
      const curveSign = random() > 0.5 ? 1 : -1

      const envelopeCount = Math.max(900, Math.round(countPerCompanion * (0.58 + envelopeStrength * 0.5)))
      const envelopeGeometry = createInteractionGeometry(
        envelopeCount,
        (_, point) => {
          const angle = random() * Math.PI * 2
          const radial = Math.sqrt(random())
          const alongRadius = separation * (0.42 + envelopeStrength * 0.12)
          const acrossRadius = Math.min(primaryRadius, companionRadius) * (0.34 + envelopeStrength * 0.16)
          const along = Math.cos(angle) * alongRadius * radial
          const across = Math.sin(angle) * acrossRadius * radial
          point.copy(midpoint)
            .addScaledVector(direction, along)
            .addScaledVector(perpendicular, across)
          point.y = gaussianLike(random, 5) * maxThickness * 0.16
          const localT = THREE.MathUtils.clamp(
            (point.clone().sub(new THREE.Vector3()).dot(direction)) / separation,
            0,
            1,
          )
          return {
            mix: localT,
            brightness: 0.12 + random() * 0.2,
          }
        },
        primaryColor,
        companionColor,
      )

      const bridgeCount = Math.max(700, Math.round(countPerCompanion * (0.32 + interaction.bridgeStrength * 0.48)))
      const bridgeGeometry = createInteractionGeometry(
        bridgeCount,
        (_, point) => {
          const t = THREE.MathUtils.clamp(random() * 1.08 - 0.04, 0, 1)
          const start = direction.clone().multiplyScalar(primaryRadius * 0.42)
          const end = companionCenter.clone().addScaledVector(direction, -companionRadius * 0.42)
          const bow = Math.sin(Math.PI * t)
          point.copy(start).lerp(end, t)
          point.addScaledVector(perpendicular, separation * 0.035 * curveSign * bow)
          const width = separation * (0.04 + bow * 0.075)
          point.addScaledVector(perpendicular, gaussianLike(random, 5) * width)
          point.addScaledVector(direction, gaussianLike(random, 4) * separation * 0.012)
          point.y += gaussianLike(random, 5) * maxThickness * 0.12
          return {
            mix: THREE.MathUtils.smoothstep(t, 0.03, 0.97),
            brightness: 0.26 + random() * 0.36,
          }
        },
        primaryColor,
        companionColor,
      )

      const tailStrength = THREE.MathUtils.clamp(interaction.tailStrength ?? 0.3, 0, 1)
      const tailCount = Math.max(520, Math.round(countPerCompanion * (0.18 + tailStrength * 0.32)))
      const tailGeometry = createInteractionGeometry(
        tailCount,
        (_, point) => {
          const fromPrimary = random() < 0.5
          const t = Math.pow(random(), 0.72)
          const sourceCenter = fromPrimary ? new THREE.Vector3() : companionCenter.clone()
          const sourceRadius = fromPrimary ? primaryRadius : companionRadius
          const outward = fromPrimary ? direction.clone().multiplyScalar(-1) : direction.clone()
          const sign = fromPrimary ? curveSign : -curveSign
          const start = sourceCenter.clone().addScaledVector(outward, sourceRadius * 0.62)
          const length = sourceRadius * (0.42 + tailStrength * 0.48)
          const fanWidth = sourceRadius * (0.045 + t * 0.1)
          point.copy(start)
            .addScaledVector(outward, length * t)
            .addScaledVector(perpendicular, sign * sourceRadius * 0.28 * Math.sin(Math.PI * t))
          point.addScaledVector(perpendicular, gaussianLike(random, 5) * fanWidth)
          point.addScaledVector(outward, gaussianLike(random, 4) * sourceRadius * 0.018)
          point.y += gaussianLike(random, 4) * maxThickness * 0.1
          return {
            mix: fromPrimary ? 0.05 : 0.95,
            brightness: 0.14 + random() * 0.24,
          }
        },
        primaryColor,
        companionColor,
      )

      return [
        {
          id: `${galaxy.id}:${companion.id}:envelope`,
          geometry: envelopeGeometry,
          opacity: 0.22 + envelopeStrength * 0.16,
          size: 1.18,
        },
        {
          id: `${galaxy.id}:${companion.id}:bridge`,
          geometry: bridgeGeometry,
          opacity: 0.34 + interaction.bridgeStrength * 0.24,
          size: 1.28,
        },
        {
          id: `${galaxy.id}:${companion.id}:tails`,
          geometry: tailGeometry,
          opacity: 0.18 + tailStrength * 0.18,
          size: 1.08,
        },
      ]
    })
}


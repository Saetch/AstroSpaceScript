import { Html, useCursor } from '@react-three/drei'
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { Galaxy, PlayerIdentity, StarSystem, TrafficRoute } from '../domain/universe'
import { buildGalaxyInteractionStreams, buildGalaxyPointGeometry, galaxyGroupExtent, getGalaxyBodies } from '../procedural/galaxyGeometry'
import { getSystemPrimaryColor, getSystemPrimaryRadius, isBlackHoleSystem, isGalacticCoreSystem, SystemPrimaryVisual } from '../components/SystemPrimary'
import { GalaxyTrafficRoutes } from '../components/GalaxyTrafficRoutes'
import { ownershipKey, ownershipTone, resolveOwnership, systemOwnershipLabel } from '../domain/ownership'

const GALAXY_WORLD_SCALE = 4
const BASE_GALAXY_RADIUS = 600
const GALAXY_RADIUS = BASE_GALAXY_RADIUS * GALAXY_WORLD_SCALE
const GALAXY_ARMS = 5
const GALAXY_TWIST = 0.014
const GALAXY_ROTATION_SPEED = 0.0002
const CHARTED_ARM = 1
const BASE_CHARTED_RADIUS = 355
const CHARTED_RADIUS = BASE_CHARTED_RADIUS * GALAXY_WORLD_SCALE
const LABEL_VISIBILITY_DISTANCE = 720 * GALAXY_WORLD_SCALE
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 860 * GALAXY_WORLD_SCALE, 1380 * GALAXY_WORLD_SCALE)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0)
const GALAXY_TILT = new THREE.Euler(0, -0.14, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const TERRITORY_TEXTURE_SIZE = 1024

type TerritorySource = {
  systemId: string
  position: THREE.Vector3
  color: THREE.Color
  colorKey: string
  radius: number
  strength: number
  name: string
}

type TerritoryGroup = {
  color: THREE.Color
  colorKey: string
  name: string
  sources: TerritorySource[]
}

type TerritoryResult = {
  winner?: TerritoryGroup
  winnerScore: number
  runnerUp?: TerritoryGroup
  runnerUpScore: number
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

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function chartedRegionCenter() {
  const angle = CHARTED_ARM * ((Math.PI * 2) / GALAXY_ARMS) + BASE_CHARTED_RADIUS * GALAXY_TWIST
  return new THREE.Vector3(Math.cos(angle) * CHARTED_RADIUS, 0, Math.sin(angle) * CHARTED_RADIUS)
}

function projectSystemPositions(systems: StarSystem[]) {
  if (systems.length === 0) return []

  const center = chartedRegionCenter()
  const centerAngle = Math.atan2(center.z, center.x)
  const radial = new THREE.Vector3(Math.cos(centerAngle), 0, Math.sin(centerAngle))
  const tangent = new THREE.Vector3(-Math.sin(centerAngle), 0, Math.cos(centerAngle))
  const averageX = systems.reduce((sum, system) => sum + system.position[0], 0) / systems.length
  const averageY = systems.reduce((sum, system) => sum + system.position[1], 0) / systems.length
  const averageZ = systems.reduce((sum, system) => sum + system.position[2], 0) / systems.length

  return systems.map((system) => {
    const localX = system.position[0] - averageX
    const localY = system.position[1] - averageY
    const localZ = system.position[2] - averageZ

    return center
      .clone()
      .addScaledVector(tangent, localX * GALAXY_WORLD_SCALE)
      .addScaledVector(radial, localZ * GALAXY_WORLD_SCALE)
      .add(new THREE.Vector3(0, localY * 0.32 * GALAXY_WORLD_SCALE, 0))
  })
}

function buildTerritoryGroups(systems: StarSystem[], positions: THREE.Vector3[]) {
  const groups = new Map<string, TerritoryGroup>()

  systems.forEach((system, index) => {
    if (!system.zoneColor || !system.zoneRadius) return
    const color = new THREE.Color(system.zoneColor)
    const visualColorKey = `#${color.getHexString()}`
    const colorKey = `${visualColorKey}:${ownershipKey(system.owner)}`
    const source: TerritorySource = {
      systemId: system.id,
      position: positions[index],
      color,
      colorKey,
      radius: Math.max(1, system.zoneRadius) * GALAXY_WORLD_SCALE,
      strength: Math.max(0.01, system.zoneStrength ?? 1),
      name: system.zoneName ?? system.faction,
    }
    const group = groups.get(colorKey)
    if (group) {
      group.sources.push(source)
    } else {
      groups.set(colorKey, {
        color: color.clone(),
        colorKey,
        name: source.name,
        sources: [source],
      })
    }
  })

  return [...groups.values()]
}

function sourceInfluence(source: TerritorySource, x: number, z: number) {
  const distance = Math.hypot(x - source.position.x, z - source.position.z)
  if (distance >= source.radius) return 0
  const normalizedReach = 1 - distance / source.radius
  return Math.pow(normalizedReach, 1.55) * source.strength
}

function evaluateTerritory(x: number, z: number, groups: TerritoryGroup[]): TerritoryResult {
  let winner: TerritoryGroup | undefined
  let winnerScore = 0
  let runnerUp: TerritoryGroup | undefined
  let runnerUpScore = 0

  for (const group of groups) {
    let score = 0
    for (const source of group.sources) score += sourceInfluence(source, x, z)

    if (score > winnerScore) {
      runnerUp = winner
      runnerUpScore = winnerScore
      winner = group
      winnerScore = score
    } else if (score > runnerUpScore) {
      runnerUp = group
      runnerUpScore = score
    }
  }

  return { winner, winnerScore, runnerUp, runnerUpScore }
}

function tintWithTerritories(color: THREE.Color, x: number, z: number, groups: TerritoryGroup[]) {
  const result = evaluateTerritory(x, z, groups)
  if (!result.winner || result.winnerScore <= 0.004) return color

  const coverage = smoothstep(0.005, 0.34, result.winnerScore)
  const dominance = result.runnerUpScore > 0
    ? THREE.MathUtils.clamp((result.winnerScore - result.runnerUpScore) / (result.winnerScore + result.runnerUpScore), 0, 1)
    : 1
  color.lerp(result.winner.color, coverage * (0.55 + dominance * 0.28))
  color.multiplyScalar(1 + coverage * 0.12)
  return color
}

function territoryKey(groups: TerritoryGroup[]) {
  return groups
    .flatMap((group) => group.sources.map((source) => `${source.systemId}:${source.position.x.toFixed(2)}:${source.position.z.toFixed(2)}:${group.colorKey}:${source.radius}:${source.strength}`))
    .join('|')
}

function MassiveGalaxyBody({
  galaxy,
  body,
  territoryGroups,
}: {
  galaxy: Galaxy
  body: ReturnType<typeof getGalaxyBodies>[number]
  territoryGroups: TerritoryGroup[]
}) {
  const displayScale = GALAXY_RADIUS / galaxyGroupExtent(galaxy)
  const displayRadius = body.radius * displayScale
  const displayThickness = Math.max(8, body.thickness * GALAXY_WORLD_SCALE)
  const displayOffset = useMemo(
    () => new THREE.Vector3(body.offset[0], body.offset[1], body.offset[2]).multiplyScalar(displayScale),
    [body.offset, displayScale],
  )
  const key = territoryKey(territoryGroups)

  const geometry = useMemo(() => {
    const relativeSize = body.radius / galaxy.radius
    const count = body.primary ? 118000 : Math.max(28000, Math.round(76000 * Math.pow(relativeSize, 1.15)))
    return buildGalaxyPointGeometry(body, {
      count,
      radius: displayRadius,
      thickness: displayThickness,
      colorTransform: (naturalColor, x, y, z) => {
        const warmCore = Math.max(0, 1 - Math.hypot(x, z) / Math.max(1, displayRadius * 0.25))
        naturalColor.multiplyScalar(THREE.MathUtils.clamp(0.88 + warmCore * 0.22, 0, 1.15))
        return tintWithTerritories(
          naturalColor,
          x + displayOffset.x,
          z + displayOffset.z,
          territoryGroups,
        )
      },
    })
    // Territory changes recolor the deterministic geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, displayOffset.x, displayOffset.z, displayRadius, displayThickness, galaxy.radius, key])

  return (
    <group
      position={displayOffset.toArray()}
      rotation={[body.inclination?.[0] ?? 0, body.rotation, body.inclination?.[2] ?? 0]}
    >
      <points geometry={geometry} renderOrder={0} frustumCulled={false}>
        <pointsMaterial
          size={1.18}
          sizeAttenuation={false}
          vertexColors
          transparent
          opacity={0.78}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {body.interactionPhase && body.interactionPhase !== 'bound' && (
        <group>
          <mesh scale={[displayRadius * 0.16, Math.max(displayThickness * 0.42, 5), displayRadius * 0.16]}>
            <sphereGeometry args={[1, 40, 24]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={0.12}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[displayRadius * 0.34, displayRadius * 0.22, 1]}>
            <circleGeometry args={[1, 96]} />
            <meshBasicMaterial
              color={body.primaryColor}
              transparent
              opacity={0.035}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {body.morphology === 'barred-spiral' && (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[displayRadius * 0.31, displayRadius * 0.052, 1]}>
            <circleGeometry args={[1, 96]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={0.055}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh scale={[displayRadius * 0.15, displayThickness * 0.22, displayRadius * 0.105]}>
            <sphereGeometry args={[1, 36, 22]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={0.085}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  )
}

function MassiveGalaxy({ galaxy, territoryGroups }: { galaxy: Galaxy; territoryGroups: TerritoryGroup[] }) {
  const bodies = useMemo(() => getGalaxyBodies(galaxy), [galaxy])
  const displayScale = GALAXY_RADIUS / galaxyGroupExtent(galaxy)
  const interactionStreams = useMemo(
    () => buildGalaxyInteractionStreams(galaxy, displayScale, 18000),
    [displayScale, galaxy],
  )

  useEffect(() => () => {
    interactionStreams.forEach((stream) => stream.geometry.dispose())
  }, [interactionStreams])

  return (
    <group>
      {interactionStreams.map((stream) => (
        <points key={stream.id} geometry={stream.geometry} renderOrder={0} frustumCulled={false}>
          <pointsMaterial
            size={stream.size}
            sizeAttenuation={false}
            vertexColors
            transparent
            opacity={stream.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      ))}

      {bodies.map((body) => (
        <MassiveGalaxyBody
          key={body.id}
          galaxy={galaxy}
          body={body}
          territoryGroups={territoryGroups}
        />
      ))}
    </group>
  )
}

function MergedTerritoryMap({ territoryGroups }: { territoryGroups: TerritoryGroup[] }) {
  const key = territoryKey(territoryGroups)

  const texture = useMemo(() => {
    const diameter = GALAXY_RADIUS * 2.08
    const threshold = 0.006
    const pixelCount = TERRITORY_TEXTURE_SIZE * TERRITORY_TEXTURE_SIZE
    const winnerIndexes = new Int16Array(pixelCount)
    const winnerScores = new Float32Array(pixelCount)
    const runnerUpScores = new Float32Array(pixelCount)
    const data = new Uint8Array(pixelCount * 4)
    winnerIndexes.fill(-1)

    const groupIndexes = new Map(territoryGroups.map((group, index) => [group.colorKey, index]))

    // DataTexture row zero maps to the plane's lower V edge. After the plane is
    // rotated into X/Z, that edge is positive world Z, so sample in that order.
    for (let py = 0; py < TERRITORY_TEXTURE_SIZE; py += 1) {
      const z = (0.5 - py / (TERRITORY_TEXTURE_SIZE - 1)) * diameter
      for (let px = 0; px < TERRITORY_TEXTURE_SIZE; px += 1) {
        const x = (px / (TERRITORY_TEXTURE_SIZE - 1) - 0.5) * diameter
        const result = evaluateTerritory(x, z, territoryGroups)
        if (!result.winner || result.winnerScore < threshold) continue

        const pixelIndex = py * TERRITORY_TEXTURE_SIZE + px
        winnerIndexes[pixelIndex] = groupIndexes.get(result.winner.colorKey) ?? -1
        winnerScores[pixelIndex] = result.winnerScore
        runnerUpScores[pixelIndex] = result.runnerUpScore
      }
    }

    const isBoundaryPixel = (px: number, py: number, winnerIndex: number) => {
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          if (ox === 0 && oy === 0) continue
          const nx = px + ox
          const ny = py + oy
          if (nx < 0 || ny < 0 || nx >= TERRITORY_TEXTURE_SIZE || ny >= TERRITORY_TEXTURE_SIZE) return true
          if (winnerIndexes[ny * TERRITORY_TEXTURE_SIZE + nx] !== winnerIndex) return true
        }
      }
      return false
    }

    for (let py = 0; py < TERRITORY_TEXTURE_SIZE; py += 1) {
      for (let px = 0; px < TERRITORY_TEXTURE_SIZE; px += 1) {
        const pixelIndex = py * TERRITORY_TEXTURE_SIZE + px
        const winnerIndex = winnerIndexes[pixelIndex]
        if (winnerIndex < 0) continue

        const winner = territoryGroups[winnerIndex]
        const winnerScore = winnerScores[pixelIndex]
        const runnerUpScore = runnerUpScores[pixelIndex]
        const coverage = smoothstep(threshold, 0.24, winnerScore)
        const dominance = runnerUpScore > 0
          ? THREE.MathUtils.clamp((winnerScore - runnerUpScore) / (winnerScore + runnerUpScore), 0, 1)
          : 1
        const boundary = isBoundaryPixel(px, py, winnerIndex)
        const displayColor = winner.color.clone()

        if (boundary) displayColor.lerp(new THREE.Color('#ffffff'), 0.48)
        else displayColor.multiplyScalar(0.88 + coverage * 0.12)

        const alpha = boundary
          ? 0.98
          : THREE.MathUtils.clamp(0.105 + coverage * 0.12 + dominance * 0.035, 0.105, 0.27)
        const dataIndex = pixelIndex * 4
        data[dataIndex] = Math.round(THREE.MathUtils.clamp(displayColor.r, 0, 1) * 255)
        data[dataIndex + 1] = Math.round(THREE.MathUtils.clamp(displayColor.g, 0, 1) * 255)
        data[dataIndex + 2] = Math.round(THREE.MathUtils.clamp(displayColor.b, 0, 1) * 255)
        data[dataIndex + 3] = Math.round(alpha * 255)
      }
    }

    const result = new THREE.DataTexture(
      data,
      TERRITORY_TEXTURE_SIZE,
      TERRITORY_TEXTURE_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    result.colorSpace = THREE.SRGBColorSpace
    result.minFilter = THREE.NearestFilter
    result.magFilter = THREE.NearestFilter
    result.generateMipmaps = false
    result.flipY = false
    result.needsUpdate = true
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => () => texture.dispose(), [texture])

  if (territoryGroups.length === 0) return null

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]} renderOrder={1}>
      <planeGeometry args={[GALAXY_RADIUS * 2.08, GALAXY_RADIUS * 2.08]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  )
}

function SystemInstances({ systems, positions, onOpenSystem, onHover }: {
  systems: StarSystem[]
  positions: THREE.Vector3[]
  onOpenSystem: (id: string) => void
  onHover: (index?: number) => void
}) {
  const cores = useRef<THREE.InstancedMesh>(null)
  const glows = useRef<THREE.InstancedMesh>(null)
  const hitTargets = useRef<THREE.InstancedMesh>(null)
  const coreGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 2), [])
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(1, 16, 16), [])
  const hitGeometry = useMemo(() => new THREE.SphereGeometry(1, 10, 10), [])
  const coreMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff', toneMapped: false, depthTest: false, blending: THREE.AdditiveBlending,
  }), [])
  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.58,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }), [])
  const hitMaterial = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    if (!cores.current || !glows.current || !hitTargets.current) return

    positions.forEach((position, index) => {
      const baseScale = 1.95 + getSystemPrimaryRadius(systems[index]) * 0.46
      const color = new THREE.Color(getSystemPrimaryColor(systems[index]))
      dummy.position.copy(position)
      dummy.scale.setScalar(baseScale)
      dummy.updateMatrix()
      cores.current!.setMatrixAt(index, dummy.matrix)
      cores.current!.setColorAt(index, color)

      dummy.scale.setScalar(baseScale * 5.1)
      dummy.updateMatrix()
      glows.current!.setMatrixAt(index, dummy.matrix)
      glows.current!.setColorAt(index, color)

      dummy.scale.setScalar(Math.max(11, baseScale * 6.2))
      dummy.updateMatrix()
      hitTargets.current!.setMatrixAt(index, dummy.matrix)
    })

    cores.current.instanceMatrix.needsUpdate = true
    glows.current.instanceMatrix.needsUpdate = true
    hitTargets.current.instanceMatrix.needsUpdate = true
    if (cores.current.instanceColor) cores.current.instanceColor.needsUpdate = true
    if (glows.current.instanceColor) glows.current.instanceColor.needsUpdate = true
  }, [dummy, positions, systems])

  function resolveInstance(event: ThreeEvent<PointerEvent | MouseEvent>) {
    event.stopPropagation()
    return event.instanceId
  }

  return (
    <group>
      <instancedMesh ref={cores} args={[coreGeometry, coreMaterial, systems.length]} frustumCulled={false} renderOrder={12}
        onPointerMove={(event) => onHover(resolveInstance(event))} onPointerOut={() => onHover(undefined)}
        onClick={(event) => { const id = resolveInstance(event); if (id !== undefined) onOpenSystem(systems[id].id) }} />
      <instancedMesh ref={glows} args={[glowGeometry, glowMaterial, systems.length]} frustumCulled={false} renderOrder={11}
        onPointerMove={(event) => onHover(resolveInstance(event))} onPointerOut={() => onHover(undefined)}
        onClick={(event) => { const id = resolveInstance(event); if (id !== undefined) onOpenSystem(systems[id].id) }} />
      <instancedMesh ref={hitTargets} args={[hitGeometry, hitMaterial, systems.length]} frustumCulled={false} renderOrder={13}
        onPointerMove={(event) => onHover(resolveInstance(event))} onPointerOut={() => onHover(undefined)}
        onClick={(event) => { const id = resolveInstance(event); if (id !== undefined) onOpenSystem(systems[id].id) }} />
    </group>
  )
}

function SystemBeacon({ system, position, hovered, labelsVisible, currentPlayer, onHover, onOpen }: {
  system: StarSystem
  position: THREE.Vector3
  hovered: boolean
  labelsVisible: boolean
  currentPlayer: PlayerIdentity
  onHover: (hovered: boolean) => void
  onOpen: () => void
}) {
  const ownership = resolveOwnership(system.owner, currentPlayer)
  const claimed = ownership.relation !== 'unclaimed'
  const tone = ownershipTone(ownership)
  const blackHole = isBlackHoleSystem(system)
  const beaconColor = blackHole ? getSystemPrimaryColor(system) : claimed ? system.zoneColor ?? '#87dcff' : '#f3bb65'

  return (
    <group position={position.toArray()}
      onPointerOver={(event) => { event.stopPropagation(); onHover(true) }}
      onPointerOut={() => onHover(false)}
      onClick={(event) => { event.stopPropagation(); onOpen() }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={15}>
        <ringGeometry args={[hovered ? 5.7 : 4.5, hovered ? 6.3 : 5.1, 64]} />
        <meshBasicMaterial color={hovered ? '#ffffff' : beaconColor} transparent opacity={0.92} side={THREE.DoubleSide} toneMapped={false} depthTest={false} />
      </mesh>
      {blackHole ? (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh renderOrder={16}>
            <circleGeometry args={[2.8, 48]} />
            <meshBasicMaterial color="#000000" toneMapped={false} depthTest={false} />
          </mesh>
          <mesh renderOrder={17}>
            <ringGeometry args={[3.2, 4.1, 64]} />
            <meshBasicMaterial color={beaconColor} transparent opacity={0.95} side={THREE.DoubleSide} toneMapped={false} depthTest={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      ) : !claimed && (
        <mesh rotation={[Math.PI / 2, 0, Math.PI / 4]} renderOrder={15}>
          <ringGeometry args={[7.2, 7.65, 4]} />
          <meshBasicMaterial color="#f3bb65" transparent opacity={hovered ? 0.95 : 0.68} side={THREE.DoubleSide} toneMapped={false} depthTest={false} />
        </mesh>
      )}
      <mesh position={[0, 5.2, 0]} renderOrder={15}>
        <cylinderGeometry args={[0.18, 0.18, 10.4, 8]} />
        <meshBasicMaterial color={beaconColor} transparent opacity={0.58} toneMapped={false} depthTest={false} />
      </mesh>
      {(labelsVisible || hovered) && (
        <Html center position={[0, 13, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`world-label system-label relationship-label relationship-label--${tone} ${hovered ? 'world-label--active' : ''}`}>
            <strong>{system.name}</strong>
            <span>
              {blackHole
                ? `BLACK HOLE · ${systemOwnershipLabel(ownership)} · click to visit`
                : ownership.relation === 'unclaimed'
                  ? `UNCLAIMED · ${system.planets.length} survey worlds · click to inspect`
                  : `${systemOwnershipLabel(ownership)} · ${system.planets.length} charted worlds · click to visit`}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}

function GalacticCoreMarker({ system, labelsVisible, onOpen }: {
  system: StarSystem
  labelsVisible: boolean
  onOpen: () => void
}) {
  const root = useRef<THREE.Group>(null)
  const entry = useRef(0)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  useFrame((_, delta) => {
    entry.current = THREE.MathUtils.damp(entry.current, 1, 3.1, delta)
    if (root.current) {
      const hoverScale = hovered ? 1.075 : 1
      root.current.scale.setScalar(Math.max(0.02, entry.current) * hoverScale)
    }
  })

  return (
    <group
      position={[0, 5, 0]}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
    >
      <group ref={root} scale={0.02}>
        <SystemPrimaryVisual system={system} scale={0.72} detail="system" animationScale={0} />

        <mesh scale={[18, 7, 18]} renderOrder={25}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
        </mesh>
      </group>

      <Html center position={[0, 24, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`world-label galactic-core-label ${hovered ? 'world-label--active' : ''}`}>
          <strong>{system.name}</strong>
          <span>{labelsVisible || hovered ? `GALACTIC CORE · ${system.blackHole?.massSolar.toLocaleString('en') ?? 'SUPERMASSIVE'} M☉ · click to inspect` : 'GALACTIC CORE · click to inspect'}</span>
        </div>
      </Html>
    </group>
  )
}

function ChartedRegion({ center, labelsVisible }: { center: THREE.Vector3; labelsVisible: boolean }) {
  if (labelsVisible) return null

  return (
    <Html center position={[center.x, center.y + 88, center.z]} style={{ pointerEvents: 'none' }}>
      <div className="charted-region-label">
        <strong>CHARTED REGION</strong>
        <span>Zoom in to reveal individual systems</span>
      </div>
    </Html>
  )
}

export function GalaxyScene({ galaxy, systems, trafficRoutes, followRotation, resetOrientationToken, currentPlayer, onLabelsVisibilityChange, onOpenSystem }: {
  galaxy: Galaxy
  systems: StarSystem[]
  trafficRoutes: TrafficRoute[]
  followRotation: boolean
  resetOrientationToken: number
  currentPlayer: PlayerIdentity
  onLabelsVisibilityChange?: (visible: boolean) => void
  onOpenSystem: (id: string) => void
}) {
  const rotationRoot = useRef<THREE.Group>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number>()
  const [labelsVisible, setLabelsVisible] = useState(false)
  const labelsVisibleRef = useRef(false)
  const { camera, controls } = useThree()
  useCursor(hoveredIndex !== undefined)
  const coreSystems = useMemo(() => systems.filter(isGalacticCoreSystem), [systems])
  const navigableSystems = useMemo(() => systems.filter((system) => !isGalacticCoreSystem(system)), [systems])
  const positions = useMemo(() => projectSystemPositions(navigableSystems), [navigableSystems])
  const regionCenter = useMemo(() => chartedRegionCenter(), [])
  const territoryGroups = useMemo(() => buildTerritoryGroups(navigableSystems, positions), [navigableSystems, positions])

  useEffect(() => {
    if (rotationRoot.current) rotationRoot.current.rotation.set(0, 0, 0)
    camera.position.copy(DEFAULT_CAMERA_POSITION)
    camera.up.set(0, 1, 0)
    camera.lookAt(DEFAULT_CAMERA_TARGET)
    camera.updateProjectionMatrix()
    const orbitControls = controls as OrbitControlsImpl | undefined
    if (orbitControls) {
      orbitControls.target.copy(DEFAULT_CAMERA_TARGET)
      orbitControls.update()
    }
  }, [camera, controls, resetOrientationToken])

  useEffect(() => {
    onLabelsVisibilityChange?.(labelsVisible)
  }, [labelsVisible, onLabelsVisibilityChange])

  useFrame((_, delta) => {
    const rotationDelta = delta * GALAXY_ROTATION_SPEED
    if (rotationRoot.current) rotationRoot.current.rotation.y += rotationDelta

    const orbitControls = controls as OrbitControlsImpl | undefined

    if (followRotation) {
      camera.position.applyAxisAngle(Y_AXIS, rotationDelta)
      orbitControls?.target.applyAxisAngle(Y_AXIS, rotationDelta)
    }

    // Keep galaxy navigation anchored to the galactic plane while allowing
    // users to pan to any X/Z point and orbit around that local table point.
    if (orbitControls) {
      orbitControls.target.y = 0
      orbitControls.update()
    }

    const rootRotation = rotationRoot.current?.rotation.y ?? 0
    const worldRegionCenter = regionCenter.clone().applyEuler(GALAXY_TILT).applyAxisAngle(Y_AXIS, rootRotation)
    const shouldShowLabels = navigableSystems.length > 0 && camera.position.distanceTo(worldRegionCenter) < LABEL_VISIBILITY_DISTANCE
    if (shouldShowLabels !== labelsVisibleRef.current) {
      labelsVisibleRef.current = shouldShowLabels
      setLabelsVisible(shouldShowLabels)
    }
  })

  return (
    <group ref={rotationRoot}>
      <group rotation={[GALAXY_TILT.x, GALAXY_TILT.y, GALAXY_TILT.z]}>
        <MassiveGalaxy galaxy={galaxy} territoryGroups={territoryGroups} />
        <MergedTerritoryMap territoryGroups={territoryGroups} />
        <pointLight position={[0, 8, 0]} color={galaxy.primaryColor} intensity={220} distance={220} />
        {navigableSystems.length > 0 && <ChartedRegion center={regionCenter} labelsVisible={labelsVisible} />}
        {coreSystems.map((coreSystem) => (
          <GalacticCoreMarker
            key={coreSystem.id}
            system={coreSystem}
            labelsVisible={labelsVisible}
            onOpen={() => onOpenSystem(coreSystem.id)}
          />
        ))}
        <GalaxyTrafficRoutes routes={trafficRoutes} systems={navigableSystems} positions={positions} detailVisible={labelsVisible} />
        <SystemInstances systems={navigableSystems} positions={positions} onOpenSystem={onOpenSystem} onHover={setHoveredIndex} />
        {navigableSystems.map((system, index) => (
          <SystemBeacon key={system.id} system={system} position={positions[index]} hovered={hoveredIndex === index}
            labelsVisible={labelsVisible} currentPlayer={currentPlayer}
            onHover={(hovered) => setHoveredIndex(hovered ? index : undefined)}
            onOpen={() => onOpenSystem(system.id)} />
        ))}
      </group>
    </group>
  )
}

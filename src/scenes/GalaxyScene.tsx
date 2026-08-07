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
const GALAXY_ROTATION_SPEED = 0.0002
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

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function primaryGalaxyBody(galaxy: Galaxy) {
  const bodies = getGalaxyBodies(galaxy)
  return bodies.find((body) => body.primary) ?? bodies[0]
}

function galaxyDisplayScale(galaxy: Galaxy) {
  return GALAXY_RADIUS / galaxyGroupExtent(galaxy)
}

function bodyDisplayThickness(body: ReturnType<typeof getGalaxyBodies>[number]) {
  return Math.max(8, body.thickness * GALAXY_WORLD_SCALE)
}

/**
 * Converts backend galaxy-local coordinates into the opened galaxy scene.
 *
 * Backend convention:
 * - (0, 0, 0) is the center of the galaxy.
 * - x/z are measured in the same local units as galaxy.radius.
 * - y is measured in the same local units as galaxy.thickness.
 *
 * The common GALAXY_TILT is applied by the parent group, so it must not be
 * applied here. Only the primary body's own transform belongs here.
 */
function projectSystemPositions(galaxy: Galaxy, systems: StarSystem[]) {
  const body = primaryGalaxyBody(galaxy)
  if (!body) return []

  const radialScale = galaxyDisplayScale(galaxy)
  const verticalScale = body.thickness > 0
    ? bodyDisplayThickness(body) / body.thickness
    : GALAXY_WORLD_SCALE

  const bodyOffset = new THREE.Vector3(
    body.offset[0],
    body.offset[1],
    body.offset[2],
  ).multiplyScalar(radialScale)

  const bodyRotation = new THREE.Euler(
    body.inclination?.[0] ?? 0,
    body.rotation,
    body.inclination?.[2] ?? 0,
  )

  return systems.map((system) =>
    new THREE.Vector3(
      system.position[0] * radialScale,
      system.position[1] * verticalScale,
      system.position[2] * radialScale,
    )
      .applyEuler(bodyRotation)
      .add(bodyOffset),
  )
}

function buildTerritoryGroups(
  systems: StarSystem[],
  positions: THREE.Vector3[],
  displayScale: number,
) {
  const groups = new Map<string, TerritoryGroup>()

  systems.forEach((system, index) => {
    if (!system.zoneColor) return
    const influenceRadius = system.zoneRadius ?? system.influenceRadius
    const influenceStrength = system.zoneStrength ?? system.influenceStrength
    if (!influenceRadius) return
    const color = new THREE.Color(system.zoneColor)
    const visualColorKey = `#${color.getHexString()}`
    const colorKey = `${visualColorKey}:${ownershipKey(system.owner)}`
    const source: TerritorySource = {
      systemId: system.id,
      position: positions[index],
      color,
      colorKey,
      radius: Math.max(1, influenceRadius) * displayScale,
      strength: Math.max(0.01, influenceStrength),
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
  const displayScale = galaxyDisplayScale(galaxy)
  const displayRadius = body.radius * displayScale
  const displayThickness = bodyDisplayThickness(body)

  const displayOffset = useMemo(
      () =>
          new THREE.Vector3(
              body.offset[0],
              body.offset[1],
              body.offset[2],
          ).multiplyScalar(displayScale),
      [body.offset, displayScale],
  )

  const territoryGeometryKey = territoryKey(territoryGroups)

  const [geometry, setGeometry] =
      useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    const relativeSize = body.radius / galaxy.radius

    const count = body.primary
        ? 118000
        : Math.max(
            28000,
            Math.round(
                76000 * Math.pow(relativeSize, 1.15),
            ),
        )

    const bodyRotation = new THREE.Euler(
      body.inclination?.[0] ?? 0,
      body.rotation,
      body.inclination?.[2] ?? 0,
    )
    const territoryPoint = new THREE.Vector3()

    const nextGeometry = buildGalaxyPointGeometry(body, {
      count,
      radius: displayRadius,
      thickness: displayThickness,
      colorTransform: (color, x, y, z) => {
        territoryPoint
          .set(x, y, z)
          .applyEuler(bodyRotation)
          .add(displayOffset)

        return tintWithTerritories(
          color,
          territoryPoint.x,
          territoryPoint.z,
          territoryGroups,
        )
      },
    })

    setGeometry(nextGeometry)

    return () => nextGeometry.dispose()
  }, [
    body,
    displayOffset.x,
    displayOffset.z,
    displayRadius,
    displayThickness,
    galaxy.radius,
    territoryGeometryKey,
  ])

  if (!geometry) {
    return null
  }

  return (
      <group
          position={displayOffset.toArray()}
          rotation={[
            body.inclination?.[0] ?? 0,
            body.rotation,
            body.inclination?.[2] ?? 0,
          ]}
      >
        <points
            geometry={geometry}
            renderOrder={0}
            frustumCulled={false}
        >
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

        {/* Remaining meshes */}
      </group>
  )
}

function MassiveGalaxy({ galaxy, territoryGroups }: { galaxy: Galaxy; territoryGroups: TerritoryGroup[] }) {
  const geometryKey = [
    galaxy.id,
    galaxy.radius,
    galaxy.thickness,
    galaxy.morphology,
    galaxy.primaryColor,
    galaxy.secondaryColor,
    galaxy.seed,
    galaxy.armCount,
    galaxy.armWinding,
    galaxy.barLength,
  ].join('|')

  const bodies = useMemo(
      () => getGalaxyBodies(galaxy),
      [geometryKey],
  )
  const displayScale = galaxyDisplayScale(galaxy)
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
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
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
          ? 0.72
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
    result.minFilter = THREE.LinearFilter
    result.magFilter = THREE.LinearFilter
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

function SystemInstances({ systems, positions, currentPlayer, onOpenSystem, onHover }: {
  systems: StarSystem[]
  positions: THREE.Vector3[]
  currentPlayer: PlayerIdentity
  onOpenSystem: (id: string) => void
  onHover: (index?: number) => void
}) {
  const cores = useRef<THREE.InstancedMesh>(null)
  const glows = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const stems = useRef<THREE.InstancedMesh>(null)
  const unclaimedDiamonds = useRef<THREE.InstancedMesh>(null)
  const blackHoleDiscs = useRef<THREE.InstancedMesh>(null)
  const blackHoleRings = useRef<THREE.InstancedMesh>(null)
  const hitTargets = useRef<THREE.InstancedMesh>(null)

  const markerKinds = useMemo(() => {
    const unclaimedIndexes: number[] = []
    const blackHoleIndexes: number[] = []

    systems.forEach((system, index) => {
      if (resolveOwnership(system.owner, currentPlayer).relation === 'unclaimed') {
        unclaimedIndexes.push(index)
      }
      if (isBlackHoleSystem(system)) blackHoleIndexes.push(index)
    })

    return { unclaimedIndexes, blackHoleIndexes }
  }, [currentPlayer, systems])

  const coreGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), [])
  const ringGeometry = useMemo(() => new THREE.RingGeometry(4.5, 5.1, 32), [])
  const stemGeometry = useMemo(() => new THREE.CylinderGeometry(0.18, 0.18, 10.4, 6), [])
  const unclaimedGeometry = useMemo(() => new THREE.RingGeometry(7.2, 7.65, 4), [])
  const blackHoleDiscGeometry = useMemo(() => new THREE.CircleGeometry(2.8, 24), [])
  const blackHoleRingGeometry = useMemo(() => new THREE.RingGeometry(3.2, 4.1, 32), [])
  const hitGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 0), [])

  const coreMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), [])
  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), [])
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
  }), [])
  const stemMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.46,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
  }), [])
  const unclaimedMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#f3bb65',
    transparent: true,
    opacity: 0.66,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
  }), [])
  const blackHoleDiscMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#000000',
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
  }), [])
  const blackHoleRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), [])
  const hitMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  }), [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    if (!cores.current || !glows.current || !rings.current || !stems.current || !hitTargets.current) return

    positions.forEach((position, index) => {
      const system = systems[index]
      const baseScale = 1.95 + getSystemPrimaryRadius(system) * 0.46
      const primaryColor = new THREE.Color(getSystemPrimaryColor(system))
      const ownership = resolveOwnership(system.owner, currentPlayer)
      const beaconColor = new THREE.Color(
        isBlackHoleSystem(system)
          ? getSystemPrimaryColor(system)
          : ownership.relation === 'unclaimed'
            ? '#f3bb65'
            : system.zoneColor ?? '#87dcff',
      )

      dummy.position.copy(position)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(baseScale)
      dummy.updateMatrix()
      cores.current!.setMatrixAt(index, dummy.matrix)
      cores.current!.setColorAt(index, primaryColor)

      dummy.scale.setScalar(baseScale * 5.1)
      dummy.updateMatrix()
      glows.current!.setMatrixAt(index, dummy.matrix)
      glows.current!.setColorAt(index, primaryColor)

      dummy.rotation.set(Math.PI / 2, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      rings.current!.setMatrixAt(index, dummy.matrix)
      rings.current!.setColorAt(index, beaconColor)

      dummy.position.set(position.x, position.y + 5.2, position.z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      stems.current!.setMatrixAt(index, dummy.matrix)
      stems.current!.setColorAt(index, beaconColor)

      dummy.position.copy(position)
      dummy.scale.setScalar(Math.max(11, baseScale * 6.2))
      dummy.updateMatrix()
      hitTargets.current!.setMatrixAt(index, dummy.matrix)
    })

    markerKinds.unclaimedIndexes.forEach((systemIndex, instanceIndex) => {
      if (!unclaimedDiamonds.current) return
      dummy.position.copy(positions[systemIndex])
      dummy.rotation.set(Math.PI / 2, 0, Math.PI / 4)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      unclaimedDiamonds.current.setMatrixAt(instanceIndex, dummy.matrix)
    })

    markerKinds.blackHoleIndexes.forEach((systemIndex, instanceIndex) => {
      if (!blackHoleDiscs.current || !blackHoleRings.current) return
      const system = systems[systemIndex]
      dummy.position.copy(positions[systemIndex])
      dummy.rotation.set(Math.PI / 2, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      blackHoleDiscs.current.setMatrixAt(instanceIndex, dummy.matrix)
      blackHoleRings.current.setMatrixAt(instanceIndex, dummy.matrix)
      blackHoleRings.current.setColorAt(instanceIndex, new THREE.Color(getSystemPrimaryColor(system)))
    })

    const meshes = [
      cores.current,
      glows.current,
      rings.current,
      stems.current,
      hitTargets.current,
      unclaimedDiamonds.current,
      blackHoleDiscs.current,
      blackHoleRings.current,
    ].filter((mesh): mesh is THREE.InstancedMesh => Boolean(mesh))

    meshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [currentPlayer, dummy, markerKinds, positions, systems])

  function resolveInstance(event: ThreeEvent<PointerEvent | MouseEvent>) {
    event.stopPropagation()
    return event.instanceId
  }

  useEffect(() => {
    return () => {
      coreGeometry.dispose()
      glowGeometry.dispose()
      ringGeometry.dispose()
      stemGeometry.dispose()
      unclaimedGeometry.dispose()
      blackHoleDiscGeometry.dispose()
      blackHoleRingGeometry.dispose()
      hitGeometry.dispose()

      coreMaterial.dispose()
      glowMaterial.dispose()
      ringMaterial.dispose()
      stemMaterial.dispose()
      unclaimedMaterial.dispose()
      blackHoleDiscMaterial.dispose()
      blackHoleRingMaterial.dispose()
      hitMaterial.dispose()
    }
  }, [
    blackHoleDiscGeometry,
    blackHoleDiscMaterial,
    blackHoleRingGeometry,
    blackHoleRingMaterial,
    coreGeometry,
    coreMaterial,
    glowGeometry,
    glowMaterial,
    hitGeometry,
    hitMaterial,
    ringGeometry,
    ringMaterial,
    stemGeometry,
    stemMaterial,
    unclaimedGeometry,
    unclaimedMaterial,
  ])

  return (
    <group>
      <instancedMesh ref={glows} args={[glowGeometry, glowMaterial, systems.length]} renderOrder={11} />
      <instancedMesh ref={cores} args={[coreGeometry, coreMaterial, systems.length]} renderOrder={12} />
      <instancedMesh ref={rings} args={[ringGeometry, ringMaterial, systems.length]} renderOrder={15} />
      <instancedMesh ref={stems} args={[stemGeometry, stemMaterial, systems.length]} renderOrder={15} />

      {markerKinds.unclaimedIndexes.length > 0 && (
        <instancedMesh
          ref={unclaimedDiamonds}
          args={[unclaimedGeometry, unclaimedMaterial, markerKinds.unclaimedIndexes.length]}
          renderOrder={15}
        />
      )}

      {markerKinds.blackHoleIndexes.length > 0 && (
        <>
          <instancedMesh
            ref={blackHoleDiscs}
            args={[blackHoleDiscGeometry, blackHoleDiscMaterial, markerKinds.blackHoleIndexes.length]}
            renderOrder={16}
          />
          <instancedMesh
            ref={blackHoleRings}
            args={[blackHoleRingGeometry, blackHoleRingMaterial, markerKinds.blackHoleIndexes.length]}
            renderOrder={17}
          />
        </>
      )}

      {/* Only this low-poly mesh participates in pointer raycasting. */}
      <instancedMesh
        ref={hitTargets}
        args={[hitGeometry, hitMaterial, systems.length]}
        renderOrder={18}
        onPointerMove={(event) => onHover(resolveInstance(event))}
        onPointerOut={() => onHover(undefined)}
        onClick={(event) => {
          const id = resolveInstance(event)
          if (id !== undefined) onOpenSystem(systems[id].id)
        }}
      />
    </group>
  )
}

function HoveredSystemMarker({ system, position, currentPlayer }: {
  system: StarSystem
  position: THREE.Vector3
  currentPlayer: PlayerIdentity
}) {
  const ownership = resolveOwnership(system.owner, currentPlayer)
  const tone = ownershipTone(ownership)
  const blackHole = isBlackHoleSystem(system)
  const beaconColor = blackHole
    ? getSystemPrimaryColor(system)
    : ownership.relation === 'unclaimed'
      ? '#f3bb65'
      : system.zoneColor ?? '#87dcff'

  return (
    <group position={position.toArray()}>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[6.1, 7.15, 48]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.96}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, 5.2, 0]} renderOrder={20}>
        <cylinderGeometry args={[0.25, 0.25, 10.4, 8]} />
        <meshBasicMaterial
          color={beaconColor}
          transparent
          opacity={0.88}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <Html center position={[0, 13, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`world-label system-label relationship-label relationship-label--${tone} world-label--active`}>
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
    </group>
  )
}

function GalacticCoreMarker({ system, position, labelsVisible, onOpen }: {
  system: StarSystem
  position: THREE.Vector3
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
      position={position.toArray()}
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
  const displayScale = useMemo(() => galaxyDisplayScale(galaxy), [galaxy])
  const coreSystems = useMemo(() => systems.filter(isGalacticCoreSystem), [systems])
  const navigableSystems = useMemo(() => systems.filter((system) => !isGalacticCoreSystem(system)), [systems])
  const corePositions = useMemo(
    () => projectSystemPositions(galaxy, coreSystems),
    [coreSystems, galaxy],
  )
  const positions = useMemo(
    () => projectSystemPositions(galaxy, navigableSystems),
    [galaxy, navigableSystems],
  )
  const territoryGroups = useMemo(
    () => buildTerritoryGroups(navigableSystems, positions, displayScale),
    [displayScale, navigableSystems, positions],
  )

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

    if (orbitControls) {
      orbitControls.target.y = 0
      orbitControls.update()
    }

    const shouldShowLabels =
      navigableSystems.length > 0 &&
      camera.position.distanceTo(DEFAULT_CAMERA_TARGET) < LABEL_VISIBILITY_DISTANCE

    if (shouldShowLabels !== labelsVisibleRef.current) {
      labelsVisibleRef.current = shouldShowLabels
      setLabelsVisible(shouldShowLabels)
    }
  })

  useEffect(() => {
    if (rotationRoot.current) {
      rotationRoot.current.rotation.set(0, 0, 0)
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 46
      camera.near = 0.1
      camera.far = 24000
    }

    camera.position.copy(DEFAULT_CAMERA_POSITION)
    camera.up.set(0, 1, 0)
    camera.lookAt(DEFAULT_CAMERA_TARGET)
    camera.updateProjectionMatrix()

    const orbitControls =
        controls as OrbitControlsImpl | undefined

    if (orbitControls) {
      orbitControls.target.copy(DEFAULT_CAMERA_TARGET)
      orbitControls.update()
    }
  }, [camera, controls, resetOrientationToken])



  return (
    <group ref={rotationRoot}>
      <group rotation={[GALAXY_TILT.x, GALAXY_TILT.y, GALAXY_TILT.z]}>
        <MassiveGalaxy galaxy={galaxy} territoryGroups={territoryGroups} />
        <MergedTerritoryMap territoryGroups={territoryGroups} />
        <pointLight position={[0, 8, 0]} color={galaxy.primaryColor} intensity={220} distance={220} />
        {coreSystems.map((coreSystem, index) => (
          <GalacticCoreMarker
            key={coreSystem.id}
            system={coreSystem}
            position={corePositions[index]}
            labelsVisible={labelsVisible}
            onOpen={() => onOpenSystem(coreSystem.id)}
          />
        ))}
        <GalaxyTrafficRoutes routes={trafficRoutes} systems={navigableSystems} positions={positions} detailVisible={labelsVisible} />
        <SystemInstances
          systems={navigableSystems}
          positions={positions}
          currentPlayer={currentPlayer}
          onOpenSystem={onOpenSystem}
          onHover={setHoveredIndex}
        />
        {hoveredIndex !== undefined && navigableSystems[hoveredIndex] && positions[hoveredIndex] && (
          <HoveredSystemMarker
            system={navigableSystems[hoveredIndex]}
            position={positions[hoveredIndex]}
            currentPlayer={currentPlayer}
          />
        )}
      </group>
    </group>
  )
}

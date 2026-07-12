import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { StarSystem, TrafficRoute } from '../domain/universe'
import { getSystemPrimaryColor } from './SystemPrimary'

const FLOW_DOT_SPACING = 14
const FLOW_WORLD_SPEED = 42

interface RouteLane {
  id: string
  route: TrafficRoute
  curve: THREE.QuadraticBezierCurve3
  curveLength: number
  color: THREE.Color
  traffic: number
  speed: number
  flowDotCount: number
}

interface GateInstance {
  position: THREE.Vector3
  color: THREE.Color
  scale: number
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fallbackRouteColor(route: TrafficRoute, from: StarSystem, to: StarSystem) {
  if (route.color) return new THREE.Color(route.color)
  const fromColor = new THREE.Color(from.zoneColor ?? getSystemPrimaryColor(from))
  const toColor = new THREE.Color(to.zoneColor ?? getSystemPrimaryColor(to))
  return fromColor.lerp(toColor, 0.5)
}

function buildCurve(
  route: TrafficRoute,
  fromPosition: THREE.Vector3,
  toPosition: THREE.Vector3,
  laneDirection: 1 | -1,
) {
  const baseDelta = toPosition.clone().sub(fromPosition)
  const distance = Math.max(baseDelta.length(), 1)
  const baseDirection = baseDelta.normalize()
  const basePerpendicular = new THREE.Vector3(-baseDirection.z, 0, baseDirection.x).normalize()
  const routeSign = (hashString(route.id) & 1) === 0 ? 1 : -1
  const laneSide = laneDirection === 1 ? routeSign : -routeSign
  const actualFrom = laneDirection === 1 ? fromPosition : toPosition
  const actualTo = laneDirection === 1 ? toPosition : fromPosition
  const travelDirection = laneDirection === 1 ? baseDirection : baseDirection.clone().multiplyScalar(-1)

  // Short cluster routes need most of their length available for visible traffic.
  // The previous 20-unit minimum consumed nearly the entire Sol–Vesper lane.
  const standoff = THREE.MathUtils.clamp(distance * 0.065, 4, 18)
  const laneSeparation = THREE.MathUtils.clamp(distance * 0.018, 2.5, 8)
  const configuredBend = route.laneOffset ?? distance * 0.01
  const bend = THREE.MathUtils.clamp(configuredBend, 1, 6)
  const configuredLift = route.arcHeight ?? distance * 0.0015
  const lift = THREE.MathUtils.clamp(configuredLift, 0.35, 2)
  const laneOffset = basePerpendicular.clone().multiplyScalar(laneSeparation * laneSide)

  const start = actualFrom
    .clone()
    .addScaledVector(travelDirection, standoff)
    .add(laneOffset)
    .add(new THREE.Vector3(0, 4.5, 0))
  const end = actualTo
    .clone()
    .addScaledVector(travelDirection, -standoff)
    .add(laneOffset)
    .add(new THREE.Vector3(0, 4.5, 0))
  const control = start
    .clone()
    .lerp(end, 0.5)
    .addScaledVector(basePerpendicular, bend * laneSide)
    .add(new THREE.Vector3(0, lift, 0))

  return new THREE.QuadraticBezierCurve3(start, control, end)
}

function buildRouteLanes(routes: TrafficRoute[], systems: StarSystem[], positions: THREE.Vector3[]) {
  const systemIndex = new Map(systems.map((system, index) => [system.id, index]))
  const lanes: RouteLane[] = []

  routes.forEach((route) => {
    if (route.active === false) return
    const fromIndex = systemIndex.get(route.fromSystemId)
    const toIndex = systemIndex.get(route.toSystemId)
    if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) return

    const fromSystem = systems[fromIndex]
    const toSystem = systems[toIndex]
    const color = fallbackRouteColor(route, fromSystem, toSystem)
    const direction = route.direction ?? 'bidirectional'
    const laneDirections: Array<1 | -1> = direction === 'bidirectional'
      ? [1, -1]
      : direction === 'to-from'
        ? [-1]
        : [1]

    laneDirections.forEach((laneDirection) => {
      const directionalTraffic = laneDirection === 1
        ? route.trafficFromTo ?? route.traffic
        : route.trafficToFrom ?? route.traffic
      const traffic = THREE.MathUtils.clamp(directionalTraffic, 0, 1)
      if (traffic <= 0.001) return

      const curve = buildCurve(route, positions[fromIndex], positions[toIndex], laneDirection)
      const curveLength = Math.max(curve.getLength(), FLOW_DOT_SPACING)
      const availableSlots = Math.max(1, Math.floor(curveLength / FLOW_DOT_SPACING))
      const flowDotCount = THREE.MathUtils.clamp(
        Math.round(availableSlots * traffic),
        1,
        availableSlots,
      )

      lanes.push({
        id: `${route.id}:${laneDirection}`,
        route,
        curve,
        curveLength,
        color: color.clone(),
        traffic,
        speed: Math.max(0.05, route.speed ?? 1),
        flowDotCount,
      })
    })
  })

  return lanes
}

function buildGateInstances(lanes: RouteLane[]) {
  const gates: GateInstance[] = []
  const seen = new Set<string>()

  lanes.forEach((lane) => {
    for (const position of [lane.curve.getPointAt(0), lane.curve.getPointAt(1)]) {
      const key = `${Math.round(position.x)}:${Math.round(position.z)}:${lane.color.getHexString()}`
      if (seen.has(key)) continue
      seen.add(key)
      gates.push({
        position,
        color: lane.color.clone().multiplyScalar(1.15),
        scale: 5.5 + lane.traffic * 3,
      })
    }
  })

  return gates
}

function createCircleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.36, 'rgba(255,255,255,0.98)')
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function FlowLane({ lane, texture, detailVisible }: {
  lane: RouteLane
  texture: THREE.Texture
  detailVisible: boolean
}) {
  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry()
    const positions = new Float32Array(lane.flowDotCount * 3)
    const attribute = new THREE.BufferAttribute(positions, 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    result.setAttribute('position', attribute)
    result.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY)
    return result
  }, [lane.flowDotCount])

  const coreMaterial = useMemo(() => new THREE.PointsMaterial({
    color: lane.color,
    map: texture,
    size: detailVisible ? 8.5 : 7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.82 + lane.traffic * 0.18,
    alphaTest: 0.03,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [detailVisible, lane.color, lane.traffic, texture])

  const glowMaterial = useMemo(() => new THREE.PointsMaterial({
    color: lane.color,
    map: texture,
    size: detailVisible ? 18 : 14,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.18 + lane.traffic * 0.12,
    alphaTest: 0.01,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [detailVisible, lane.color, lane.traffic, texture])

  useFrame((state) => {
    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const phaseDistance = (
      (hashString(lane.id) % 1000) / 1000 * lane.curveLength
      + state.clock.elapsedTime * FLOW_WORLD_SPEED * lane.speed
    ) % lane.curveLength

    for (let index = 0; index < lane.flowDotCount; index += 1) {
      const distanceAlong = (phaseDistance + index * FLOW_DOT_SPACING) % lane.curveLength
      const point = lane.curve.getPointAt(distanceAlong / lane.curveLength)
      positionAttribute.setXYZ(index, point.x, point.y, point.z)
    }

    positionAttribute.needsUpdate = true
  })

  return (
    <group>
      <points geometry={geometry} material={glowMaterial} frustumCulled={false} renderOrder={12} />
      <points geometry={geometry} material={coreMaterial} frustumCulled={false} renderOrder={13} />
    </group>
  )
}

export function GalaxyTrafficRoutes({ routes, systems, positions, detailVisible }: {
  routes: TrafficRoute[]
  systems: StarSystem[]
  positions: THREE.Vector3[]
  detailVisible: boolean
}) {
  const lanes = useMemo(() => buildRouteLanes(routes, systems, positions), [positions, routes, systems])
  const gates = useMemo(() => buildGateInstances(lanes), [lanes])
  const gateMesh = useRef<THREE.InstancedMesh>(null)
  const gateGlowMesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const circleTexture = useMemo(createCircleTexture, [])

  const gateGeometry = useMemo(() => new THREE.TorusGeometry(1, 0.12, 8, 32), [])
  const gateMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), [])
  const gateGlowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.12,
    vertexColors: true,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }), [])

  useLayoutEffect(() => {
    if (!gateMesh.current || !gateGlowMesh.current) return

    gates.forEach((gate, index) => {
      dummy.position.copy(gate.position)
      dummy.rotation.set(Math.PI / 2, 0, 0)
      dummy.scale.setScalar(gate.scale)
      dummy.updateMatrix()
      gateMesh.current!.setMatrixAt(index, dummy.matrix)
      gateMesh.current!.setColorAt(index, gate.color)

      dummy.scale.setScalar(gate.scale * 1.55)
      dummy.updateMatrix()
      gateGlowMesh.current!.setMatrixAt(index, dummy.matrix)
      gateGlowMesh.current!.setColorAt(index, gate.color)
    })

    gateMesh.current.instanceMatrix.needsUpdate = true
    gateGlowMesh.current.instanceMatrix.needsUpdate = true
    if (gateMesh.current.instanceColor) gateMesh.current.instanceColor.needsUpdate = true
    if (gateGlowMesh.current.instanceColor) gateGlowMesh.current.instanceColor.needsUpdate = true
  }, [dummy, gates])

  if (lanes.length === 0) return null

  return (
    <group renderOrder={8}>
      {lanes.map((lane) => (
        <FlowLane key={lane.id} lane={lane} texture={circleTexture} detailVisible={detailVisible} />
      ))}
      <instancedMesh ref={gateGlowMesh} args={[gateGeometry, gateGlowMaterial, gates.length]} frustumCulled={false} renderOrder={10} />
      <instancedMesh ref={gateMesh} args={[gateGeometry, gateMaterial, gates.length]} frustumCulled={false} renderOrder={11} />
    </group>
  )
}

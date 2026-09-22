import { Html, Line } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type {
  ClientSpacecraftPlan,
  ManeuverAxis,
  ManeuverDeltaV,
  ManeuverPreview,
} from '../spatial/spacecraftManeuver'
import {
  sampleSpacecraftOrbit,
  spacecraftManeuverBasis,
  spacecraftPositionAtPhase,
  spacecraftPositionAtTime,
} from '../spatial/spacecraftManeuver'
import { getSimulationTimeSeconds } from '../spatial/simulationClock'
import { SYSTEM_UNITS_TO_WORLD } from '../spatial/renderScales'
import type { Vector3Tuple } from '../domain/universe'

const MAX_DELTA_V = 2500
const DRAG_MPS_PER_PIXEL = 8

interface DragState {
  axis: ManeuverAxis
  sign: 1 | -1
  startX: number
  startY: number
  startValue: number
  axisWorld: THREE.Vector3
}

const axisStyle: Record<ManeuverAxis, { color: string; positive: string; negative: string }> = {
  prograde: { color: '#6ee9ff', positive: 'PRO', negative: 'RET' },
  radial: { color: '#ffc96f', positive: 'OUT', negative: 'IN' },
  normal: { color: '#df8dff', positive: 'N+', negative: 'N−' },
}

function clampDeltaV(value: number) {
  return THREE.MathUtils.clamp(value, -MAX_DELTA_V, MAX_DELTA_V)
}

function tupleVector(tuple: Vector3Tuple) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2])
}

function AxisArrow({
  axis,
  direction,
  sign,
  value,
  onPointerDown,
}: {
  axis: ManeuverAxis
  direction: Vector3Tuple
  sign: 1 | -1
  value: number
  onPointerDown: (event: ThreeEvent<PointerEvent>, axis: ManeuverAxis, sign: 1 | -1, direction: THREE.Vector3) => void
}) {
  const directionVector = useMemo(
    () => tupleVector(direction).normalize().multiplyScalar(sign),
    [direction, sign],
  )
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), directionVector),
    [directionVector],
  )
  const applied = sign > 0 ? Math.max(0, value) : Math.max(0, -value)
  const extension = THREE.MathUtils.clamp(applied / 850, 0, 2.15)
  const length = 1.35 + extension
  const presentation = axisStyle[axis]

  return (
    <group quaternion={quaternion}>
      <mesh position={[0, length / 2, 0]} renderOrder={1500}>
        <cylinderGeometry args={[0.025, 0.025, length, 8]} />
        <meshBasicMaterial color={presentation.color} transparent opacity={0.72} toneMapped={false} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, length, 0]}
        renderOrder={1502}
        onPointerDown={(event) => onPointerDown(event, axis, sign, directionVector)}
        onPointerOver={(event) => {
          event.stopPropagation()
          document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <coneGeometry args={[0.17, 0.44, 12]} />
        <meshBasicMaterial color={presentation.color} toneMapped={false} depthTest={false} depthWrite={false} />
      </mesh>
      <Html
        center
        position={[0, length + 0.38, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div className={`maneuver-axis-label maneuver-axis-label--${axis}`}>
          {sign > 0 ? presentation.positive : presentation.negative}
        </div>
      </Html>
    </group>
  )
}

function ManeuverGizmo({
  position,
  basis,
  deltaV,
  valid,
  onDeltaVChange,
}: {
  position: Vector3Tuple
  basis: { prograde: Vector3Tuple; radial: Vector3Tuple; normal: Vector3Tuple }
  deltaV: ManeuverDeltaV
  valid: boolean
  onDeltaVChange: (axis: ManeuverAxis, value: number) => void
}) {
  const group = useRef<THREE.Group>(null)
  const { camera, size, gl } = useThree()
  const controls = (useThree() as unknown as { controls?: { enabled: boolean } }).controls
  const [dragging, setDragging] = useState<DragState>()
  const worldPosition = useMemo(() => tupleVector(position), [position])

  useFrame(() => {
    if (!group.current) return
    const distance = Math.max(camera.position.distanceTo(worldPosition), 0.001)
    const perspective = camera as THREE.PerspectiveCamera
    const pixelsPerWorldUnit = perspective.isPerspectiveCamera
      ? size.height / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) * distance)
      : 1
    const scale = THREE.MathUtils.clamp(58 / Math.max(pixelsPerWorldUnit, 0.00001) / 1.35, 0.55, 12_000)
    group.current.scale.setScalar(scale)
  })

  useEffect(() => {
    if (!dragging) return

    if (controls) controls.enabled = false
    const previousCursor = gl.domElement.style.cursor
    const previousTouchAction = gl.domElement.style.touchAction
    gl.domElement.style.cursor = 'grabbing'
    gl.domElement.style.touchAction = 'none'

    const projectedDirection = () => {
      const start = worldPosition.clone().project(camera)
      const end = worldPosition.clone().add(dragging.axisWorld).project(camera)
      const screen = new THREE.Vector2(
        (end.x - start.x) * size.width * 0.5,
        -(end.y - start.y) * size.height * 0.5,
      )
      return screen.lengthSq() > 0.00001 ? screen.normalize() : new THREE.Vector2(1, 0)
    }

    const handleMove = (event: PointerEvent) => {
      event.preventDefault()
      const screenAxis = projectedDirection()
      const dx = event.clientX - dragging.startX
      const dy = event.clientY - dragging.startY
      const outwardPixels = dx * screenAxis.x + dy * screenAxis.y
      const next = dragging.startValue + outwardPixels * DRAG_MPS_PER_PIXEL * dragging.sign
      onDeltaVChange(dragging.axis, clampDeltaV(next))
    }

    const finish = () => {
      setDragging(undefined)
    }

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (controls) controls.enabled = true
      gl.domElement.style.cursor = previousCursor
      gl.domElement.style.touchAction = previousTouchAction
      document.body.style.cursor = ''
    }
  }, [camera, controls, dragging, gl.domElement.style, onDeltaVChange, size.height, size.width, worldPosition])

  const beginDrag = (
    event: ThreeEvent<PointerEvent>,
    axis: ManeuverAxis,
    sign: 1 | -1,
    axisWorld: THREE.Vector3,
  ) => {
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    setDragging({
      axis,
      sign,
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      startValue: deltaV[axis],
      axisWorld: axisWorld.clone(),
    })
  }

  return (
    <group ref={group} position={position}>
      <mesh renderOrder={1498}>
        <sphereGeometry args={[0.18, 18, 18]} />
        <meshBasicMaterial
          color={valid ? '#fff1b0' : '#ff718b'}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1497}>
        <ringGeometry args={[0.28, 0.34, 36]} />
        <meshBasicMaterial
          color={valid ? '#ffd685' : '#ff718b'}
          transparent
          opacity={0.9}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {(['prograde', 'radial', 'normal'] as ManeuverAxis[]).flatMap((axis) => ([1, -1] as const).map((sign) => (
        <AxisArrow
          key={`${axis}:${sign}`}
          axis={axis}
          direction={basis[axis]}
          sign={sign}
          value={deltaV[axis]}
          onPointerDown={beginDrag}
        />
      )))}
    </group>
  )
}

export function SpacecraftManeuverScene({
  plan,
  preview,
  primaryMassSolar,
  onDeltaVChange,
}: {
  plan: ClientSpacecraftPlan
  preview: ManeuverPreview
  primaryMassSolar: number
  onDeltaVChange: (axis: ManeuverAxis, value: number) => void
}) {
  const ship = useRef<THREE.Group>(null)
  const shipHitScale = useRef<THREE.Group>(null)
  const currentPoints = useMemo(
    () => sampleSpacecraftOrbit(plan.orbit, 180, SYSTEM_UNITS_TO_WORLD),
    [plan.orbit],
  )
  const previewPoints = useMemo(
    () => sampleSpacecraftOrbit(preview.orbit, 180, SYSTEM_UNITS_TO_WORLD),
    [preview.orbit],
  )
  const burnPosition = useMemo(
    () => spacecraftPositionAtPhase(plan.orbit, plan.maneuver.burnPhase, SYSTEM_UNITS_TO_WORLD),
    [plan.orbit, plan.maneuver.burnPhase],
  )
  const maneuverBasis = useMemo(
    () => spacecraftManeuverBasis(plan.orbit, plan.maneuver.burnPhase, primaryMassSolar),
    [plan.orbit, plan.maneuver.burnPhase, primaryMassSolar],
  )

  useFrame(({ camera, size }) => {
    if (!ship.current) return
    const position = spacecraftPositionAtTime(
      plan.orbit,
      getSimulationTimeSeconds(),
      SYSTEM_UNITS_TO_WORLD,
    )
    ship.current.position.set(...position)

    // Keep the prototype ship readable at system-map scales without changing its orbit.
    const distance = camera.position.distanceTo(ship.current.position)
    const perspective = camera as THREE.PerspectiveCamera
    const pixelsPerWorldUnit = perspective.isPerspectiveCamera
      ? size.height / (
          2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) * Math.max(distance, 0.001)
        )
      : 1
    const visualScale = THREE.MathUtils.clamp(8 / Math.max(pixelsPerWorldUnit, 0.001), 0.75, 30)
    shipHitScale.current?.scale.setScalar(visualScale)
  })

  return (
    <group>
      <Line
        points={currentPoints}
        color="#7be8ff"
        transparent
        opacity={0.72}
        lineWidth={1.2}
        depthWrite={false}
      />

      {preview.deltaVMagnitude > 0.01 && preview.valid && (
        <>
          <Line
            points={previewPoints}
            color="#ffd685"
            transparent
            opacity={0.2}
            lineWidth={6}
            depthTest={false}
            depthWrite={false}
            renderOrder={1200}
          />
          <Line
            points={previewPoints}
            color="#fff0b4"
            transparent
            opacity={0.95}
            lineWidth={2}
            depthTest={false}
            depthWrite={false}
            renderOrder={1201}
          />
        </>
      )}

      <ManeuverGizmo
        position={burnPosition}
        basis={maneuverBasis}
        deltaV={plan.maneuver.deltaV}
        valid={preview.valid}
        onDeltaVChange={onDeltaVChange}
      />

      <Html center position={[burnPosition[0], burnPosition[1] + 1.1, burnPosition[2]]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div className={`maneuver-node-label ${preview.valid ? '' : 'maneuver-node-label--invalid'}`}>
          <strong>MANEUVER</strong>
          <span>Δv {Math.round(preview.deltaVMagnitude)} m/s</span>
        </div>
      </Html>

      <group ref={ship}>
        <group ref={shipHitScale}>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.28, 0.9, 5]} />
            <meshStandardMaterial
              color="#dff8ff"
              emissive="#57d8ff"
              emissiveIntensity={1.3}
              roughness={0.32}
              metalness={0.72}
            />
          </mesh>
          <pointLight color="#63ddff" intensity={1.4} distance={5} />
          <Html center position={[0, 0.75, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div className="spacecraft-label">
              <strong>{plan.name}</strong>
              <span>{plan.launchPlanetName ? `FROM ${plan.launchPlanetName.toUpperCase()}` : 'LOCAL SHIP'}</span>
            </div>
          </Html>
        </group>
      </group>
    </group>
  )
}

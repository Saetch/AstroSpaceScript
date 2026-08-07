import { Html, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Moon } from '../domain/universe'
import { getSimulationTimeSeconds } from '../spatial/simulationClock'
import { moonOrbitDefinition, orbitPositionAtTime } from '../spatial/orbit'
import { MOON_UNITS_TO_INSPECTION_WORLD, MOON_UNITS_TO_SYSTEM_WORLD } from '../spatial/renderScales'
import type { MoonFocusTarget } from './MoonFocusController'
import { OrbitRing } from './OrbitRing'

type MoonDisplayMode = 'system' | 'inspection'


function MoonOrbit({
  moon,
  mode,
  focused,
  onFocus,
}: {
  moon: Moon
  mode: MoonDisplayMode
  focused: boolean
  onFocus?: (target: MoonFocusTarget) => void
}) {
  const focusAnchor = useRef<THREE.Group>(null)
  const body = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const orbit = useMemo(() => moonOrbitDefinition(moon), [moon])
  const renderScale = mode === 'system'
    ? MOON_UNITS_TO_SYSTEM_WORLD
    : MOON_UNITS_TO_INSPECTION_WORLD
  const bodyRadius = mode === 'system'
    ? Math.max(0.045, moon.radius)
    : Math.max(0.07, moon.radius * 2.15)
  const initialPosition = useMemo(
    () => orbitPositionAtTime(orbit, getSimulationTimeSeconds(), renderScale),
    [orbit, renderScale],
  )
  useCursor(hovered)

  useFrame((_, delta) => {
    if (focusAnchor.current) {
      focusAnchor.current.position.set(
        ...orbitPositionAtTime(orbit, getSimulationTimeSeconds(), renderScale),
      )
    }
    if (body.current) body.current.rotation.y += delta * 0.16
  })

  return (
    <group>
      <OrbitRing
        orbit={orbit}
        renderScale={renderScale}
        color={focused ? '#dff8ff' : '#91a1bd'}
        opacity={focused ? 0.34 : mode === 'system' ? 0.15 : 0.1}
        lineWidth={focused ? 0.9 : 0.55}
      />
      <group
        ref={focusAnchor}
        position={initialPosition}
        userData={{ blackHoleLensingBody: true }}
      >
        <mesh ref={body}>
          <sphereGeometry
            args={[
              bodyRadius,
              mode === 'system' ? 22 : 36,
              mode === 'system' ? 22 : 36,
            ]}
          />
          <meshStandardMaterial
            color={moon.color}
            emissive={moon.secondaryColor ?? moon.color}
            emissiveIntensity={focused ? 0.24 : hovered ? 0.18 : 0.045}
            roughness={0.88}
            metalness={0.03}
          />
        </mesh>
        <mesh
          onPointerOver={(event) => {
            event.stopPropagation()
            setHovered(true)
          }}
          onPointerOut={() => setHovered(false)}
          onClick={(event) => {
            event.stopPropagation()
            if (!focusAnchor.current) return
            onFocus?.({
              id: moon.id,
              label: moon.name,
              object: focusAnchor.current,
              radius: bodyRadius,
            })
          }}
        >
          <sphereGeometry args={[bodyRadius * (mode === 'system' ? 2.8 : 2.1), 16, 16]} />
          <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
        </mesh>
        {hovered && (
          <Html
            center
            position={[0, bodyRadius + 0.22, 0]}
            distanceFactor={mode === 'system' ? 9 : 7}
            style={{ pointerEvents: 'none' }}
          >
            <div className="moon-label">
              <strong>{moon.name}</strong>
              <span>{moon.type}</span>
            </div>
          </Html>
        )}
        {focused && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[bodyRadius * 1.55, bodyRadius * 1.75, 48]} />
            <meshBasicMaterial
              color="#dff8ff"
              transparent
              opacity={0.72}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        )}
      </group>
    </group>
  )
}

export function MoonSystem({
  moons = [],
  parentRadius: _parentRadius,
  mode,
  focusedMoonId,
  onFocusMoon,
}: {
  moons?: Moon[]
  parentRadius: number
  mode: MoonDisplayMode
  focusedMoonId?: string
  onFocusMoon?: (target: MoonFocusTarget) => void
}) {
  if (moons.length === 0) return null

  return (
    <group>
      {moons.map((moon) => (
        <MoonOrbit
          key={moon.id}
          moon={moon}
          mode={mode}
          focused={focusedMoonId === moon.id}
          onFocus={onFocusMoon}
        />
      ))}
    </group>
  )
}

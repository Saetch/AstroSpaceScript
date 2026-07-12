import { Html, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import type { Planet, StarSystem } from '../domain/universe'
import { OrbitRing } from '../components/OrbitRing'
import { PlanetRings, ProceduralPlanet } from '../components/ProceduralPlanet'
import { buildPlanetSeedKey } from '../procedural/planetSeed'
import { yawForSubstellarMeshAxis } from '../procedural/tidalOrientation'
import { MoonSystem } from '../components/MoonSystem'
import { SystemPrimaryVisual } from '../components/SystemPrimary'

const ORBIT_SCALE = 2.35
const ORBIT_ANIMATION_SCALE = 0.28

function OrbitingPlanet({
  planet,
  seedKey,
  onOpen,
}: {
  planet: Planet
  seedKey: string
  onOpen: () => void
}) {
  const positionGroup = useRef<THREE.Group>(null)
  const tiltGroup = useRef<THREE.Group>(null)
  const spinGroup = useRef<THREE.Group>(null)
  const orbitAngle = useRef(planet.orbitOffset)
  const tidallyLocked = planet.tidallyLocked ?? planet.type.toLowerCase().includes('tidally locked')
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  useFrame((state, delta) => {
    orbitAngle.current += delta * planet.orbitSpeed * ORBIT_ANIMATION_SCALE

    if (positionGroup.current) {
      positionGroup.current.position.set(
        Math.cos(orbitAngle.current) * planet.orbitRadius * ORBIT_SCALE,
        0,
        Math.sin(orbitAngle.current) * planet.orbitRadius * ORBIT_SCALE,
      )
    }

    if (spinGroup.current) {
      if (tidallyLocked) {
        const starDirectionX = -Math.cos(orbitAngle.current)
        const starDirectionZ = -Math.sin(orbitAngle.current)
        spinGroup.current.rotation.y = yawForSubstellarMeshAxis(starDirectionX, starDirectionZ)
      } else {
        spinGroup.current.rotation.y += delta * 0.24
      }
    }

    if (tiltGroup.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.018
      tiltGroup.current.scale.setScalar(hovered ? pulse * 1.12 : pulse)
    }
  })

  return (
    <group
      ref={positionGroup}
      position={[
        Math.cos(planet.orbitOffset) * planet.orbitRadius * ORBIT_SCALE,
        0,
        Math.sin(planet.orbitOffset) * planet.orbitRadius * ORBIT_SCALE,
      ]}
    >
      <group
        ref={tiltGroup}
        rotation={[0, 0, THREE.MathUtils.degToRad(planet.axialTilt)]}
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
        <group
          ref={spinGroup}
          rotation={[
            0,
            tidallyLocked
              ? yawForSubstellarMeshAxis(-Math.cos(planet.orbitOffset), -Math.sin(planet.orbitOffset))
              : 0,
            0,
          ]}
        >
          <ProceduralPlanet planet={planet} seedKey={seedKey} radius={planet.radius} detail="system" />
        </group>
        <PlanetRings planet={planet} radius={planet.radius} />
      </group>
      <MoonSystem moons={planet.moons} parentRadius={planet.radius} mode="system" />

      <Html center distanceFactor={10} position={[0, planet.radius + 0.7, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`world-label ${hovered ? 'world-label--active' : ''}`}>
          <strong>{planet.name}</strong>
          <span>{planet.type}</span>
        </div>
      </Html>
    </group>
  )
}

export function SolarSystemScene({ system, onOpenPlanet }: { system: StarSystem; onOpenPlanet: (id: string) => void }) {
  return (
    <group rotation={[0.16, -0.15, 0]}>
      <ambientLight intensity={0.34} />
      <hemisphereLight color="#dce8ff" groundColor="#0a1020" intensity={0.58} />
      <SystemPrimaryVisual system={system} />
      {system.planets.map((planet) => (
        <OrbitRing key={`orbit-${planet.id}`} radius={planet.orbitRadius * ORBIT_SCALE} />
      ))}
      {system.planets.map((planet, planetIndex) => (
        <OrbitingPlanet
          key={planet.id}
          planet={planet}
          seedKey={buildPlanetSeedKey(system.position, planet.orbitIndex ?? planetIndex)}
          onOpen={() => onOpenPlanet(planet.id)}
        />
      ))}
    </group>
  )
}

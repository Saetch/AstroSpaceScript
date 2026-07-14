import { Html, useCursor } from '@react-three/drei'
import { BlackHoleLensingPass } from '../components/BlackHoleLensingPass'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import type { Planet, StarSystem } from '../domain/universe'
import { OrbitRing } from '../components/OrbitRing'
import { PlanetRings, ProceduralPlanet } from '../components/ProceduralPlanet'
import { buildPlanetSeedKey } from '../procedural/planetSeed'
import { yawForSubstellarMeshAxis } from '../procedural/tidalOrientation'
import { MoonSystem } from '../components/MoonSystem'
import { MoonFocusController, type MoonFocusTarget } from '../components/MoonFocusController'
import { isBlackHoleSystem, isGalacticCoreSystem, SystemPrimaryVisual } from '../components/SystemPrimary'

const ORBIT_SCALE = 2.35
const ORBIT_ANIMATION_SCALE = 0.28

function SystemSurveyLighting() {
  const cameraFill = useRef<THREE.PointLight>(null)

  useFrame(({ camera }) => {
    cameraFill.current?.position.copy(camera.position)
  })

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight color="#e7efff" groundColor="#172038" intensity={0.72} />
      <pointLight
        ref={cameraFill}
        color="#dbe8ff"
        intensity={1.75}
        distance={0}
        decay={0}
      />
    </>
  )
}

function OrbitingPlanet({
  planet,
  seedKey,
  focusedMoonId,
  onFocusMoon,
  onOpen,
}: {
  planet: Planet
  seedKey: string
  focusedMoonId?: string
  onFocusMoon: (target: MoonFocusTarget) => void
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
      tiltGroup.current.scale.setScalar(hovered ?  1.12 : 1)
    }
  })

  return (
    <group
      ref={positionGroup}
      userData={{ blackHoleLensingBody: true }}
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
        <PlanetRings planet={planet} radius={planet.radius} detail="system" />
      </group>
      <MoonSystem
        moons={planet.moons}
        parentRadius={planet.radius}
        mode="system"
        focusedMoonId={focusedMoonId}
        onFocusMoon={onFocusMoon}
      />

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
  const [focusedMoon, setFocusedMoon] = useState<MoonFocusTarget>()
  const primaryScale = isGalacticCoreSystem(system) ? 3.625 : 1
  const lensingInfluenceRadius = ((system.blackHole?.accretionDisk?.outerRadius ?? system.starRadius * 4) * primaryScale)
    * (system.blackHole?.lensingRadiusMultiplier ?? (isGalacticCoreSystem(system) ? 1.08 : 0.9))
  const lensingStrength = system.blackHole?.lensingStrength ?? (isGalacticCoreSystem(system) ? 1.32 : 0.92)

  return (
    <>
      {isBlackHoleSystem(system) && (
        <BlackHoleLensingPass
          influenceRadius={lensingInfluenceRadius}
          strength={lensingStrength}
        />
      )}
      <SystemSurveyLighting />
      <group rotation={[0.16, -0.15, 0]}>
      <group
        onClick={(event) => {
          if (!focusedMoon) return
          event.stopPropagation()
          setFocusedMoon(undefined)
        }}
      >
        <SystemPrimaryVisual system={system} scale={primaryScale} />
        <mesh>
          <sphereGeometry args={[
            isBlackHoleSystem(system)
              ? Math.max(system.blackHole?.eventHorizonRadius ?? system.starRadius, 0.1) * primaryScale * 1.45
              : system.starRadius * primaryScale * 1.3,
            24,
            24,
          ]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>
      {system.planets.map((planet, planetIndex) => (
        <group
          key={planet.id}
          rotation={[0, 0, THREE.MathUtils.degToRad(planet.orbitInclination ?? 0)]}
        >
          <OrbitRing radius={planet.orbitRadius * ORBIT_SCALE} />
          <OrbitingPlanet
            planet={planet}
            seedKey={buildPlanetSeedKey(system.position, planet.orbitIndex ?? planetIndex)}
            focusedMoonId={focusedMoon?.id}
            onFocusMoon={setFocusedMoon}
            onOpen={() => onOpenPlanet(planet.id)}
          />
        </group>
      ))}
        <MoonFocusController
          focus={focusedMoon}
          onClear={() => setFocusedMoon(undefined)}
          distanceMultiplier={9.5}
        />
      </group>
    </>
  )
}

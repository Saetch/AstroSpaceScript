import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Planet } from '../domain/universe'
import { samplePlanetSurfaceRadius } from './ProceduralPlanet'
import { PLANET_RADIUS_TO_INSPECTION_WORLD } from '../spatial/renderScales'

function latLonToVector3(latitude: number, longitude: number, radius: number) {
  const phi = THREE.MathUtils.degToRad(90 - latitude)
  const theta = THREE.MathUtils.degToRad(longitude + 180)
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

/**
 * Must be rendered inside PlanetScene's rotating/tilted surface group.
 * That makes the craft a literal surface object instead of a world-space marker.
 */
export function LandedSpacecraftScene({
  planet,
  seedKey,
  name,
  latitude,
  longitude,
}: {
  planet: Planet
  seedKey: string
  name: string
  latitude: number
  longitude: number
}) {
  const nominalRadius = planet.radius * PLANET_RADIUS_TO_INSPECTION_WORLD
  const craftScale = Math.max(0.16, Math.min(0.34, nominalRadius * 0.055))
  const transform = useMemo(() => {
    const surfaceRadius = samplePlanetSurfaceRadius(
      planet,
      seedKey,
      latitude,
      longitude,
      nominalRadius,
    )
    const normal = latLonToVector3(latitude, longitude, 1).normalize()
    const position = normal.clone().multiplyScalar(surfaceRadius + craftScale * 0.08)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal,
    )
    return { position, quaternion }
  }, [craftScale, latitude, longitude, nominalRadius, planet, seedKey])

  return (
    <group position={transform.position.toArray()} quaternion={transform.quaternion} scale={craftScale}>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.17, 0.23, 0.72, 8]} />
        <meshStandardMaterial
          color="#dff7ff"
          emissive="#58d9ff"
          emissiveIntensity={0.46}
          roughness={0.34}
          metalness={0.7}
        />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <coneGeometry args={[0.18, 0.34, 8]} />
        <meshStandardMaterial
          color="#f4fbff"
          emissive="#72e6ff"
          emissiveIntensity={0.58}
          roughness={0.3}
          metalness={0.68}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.25, 0.28, 0.12, 10]} />
        <meshStandardMaterial color="#182734" metalness={0.72} roughness={0.38} />
      </mesh>
      <pointLight position={[0, 0.65, 0.18]} color="#6ee9ff" intensity={1.15} distance={3.6} />
      <Html center position={[0, 1.55, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div className="spacecraft-label">
          <strong>{name}</strong>
          <span>SURFACE · AWAITING TAKEOFF</span>
        </div>
      </Html>
    </group>
  )
}

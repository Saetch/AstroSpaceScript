import { Html, Line, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Planet, StarSystem, SurfacePoint, SurfaceVisualType } from '../domain/universe'
import {
  buildUrbanLightSites,
  PlanetRings,
  ProceduralPlanet,
  samplePlanetSurfaceInfo,
  samplePlanetSurfaceRadius,
} from '../components/ProceduralPlanet'
import { hashSeed } from '../procedural/planetSeed'
import { yawForSubstellarMeshAxis } from '../procedural/tidalOrientation'
import { MoonSystem } from '../components/MoonSystem'
import { MoonFocusController, type MoonFocusTarget } from '../components/MoonFocusController'
import { BlackHoleLensingPass } from '../components/BlackHoleLensingPass'
import { getSystemPrimaryColor, getSystemPrimaryRadius, isBlackHoleSystem, isGalacticCoreSystem, SystemPrimaryVisual } from '../components/SystemPrimary'

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

function latLonToVector3(latitude: number, longitude: number, radius: number): [number, number, number] {
  const phi = THREE.MathUtils.degToRad(90 - latitude)
  const theta = THREE.MathUtils.degToRad(longitude + 180)
  return [
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

function surfaceTransform(point: SurfacePoint, radius: number) {
  const position = new THREE.Vector3(...latLonToVector3(point.latitude, point.longitude, radius))
  const normal = position.clone().normalize()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
  return { position, quaternion }
}

function LandSettlementFeature({ scale, selected, seed }: { scale: number; selected: boolean; seed: number }) {
  const layout = useMemo(() => {
    const random = seededRandom(seed)
    const districts = Array.from({ length: 3 }, (_, districtIndex) => {
      const angle = districtIndex * ((Math.PI * 2) / 3) + (random() - 0.5) * 0.42
      const distance = scale * (0.34 + random() * 0.18)
      return {
        id: districtIndex,
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        rotation: angle + Math.PI / 2,
      }
    })

    const buildings = Array.from({ length: 18 }, (_, index) => {
      const district = districts[index % districts.length]
      const localAngle = random() * Math.PI * 2
      const localDistance = scale * (0.05 + random() * 0.28)
      const footprint = scale * (0.07 + random() * 0.1)
      const height = scale * (0.18 + random() * 0.58)
      return {
        id: index,
        x: district.x + Math.cos(localAngle) * localDistance,
        z: district.z + Math.sin(localAngle) * localDistance,
        width: footprint * (0.72 + random() * 0.58),
        depth: footprint * (0.72 + random() * 0.58),
        height,
        rotation: random() * Math.PI,
        shape: random() > 0.72 ? 'round' as const : 'box' as const,
        roof: random() > 0.58 ? 'dome' as const : random() > 0.5 ? 'spire' as const : 'flat' as const,
        cool: random() > 0.56,
      }
    })

    const pads = Array.from({ length: 2 }, (_, index) => {
      const angle = Math.PI * (0.28 + index * 0.92) + (random() - 0.5) * 0.22
      const distance = scale * (0.64 + random() * 0.08)
      return {
        id: index,
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        rotation: angle,
      }
    })

    return { districts, buildings, pads }
  }, [scale, seed])

  return (
    <group>
      <mesh position={[0, scale * 0.022, 0]}>
        <cylinderGeometry args={[scale * 0.92, scale * 1.02, scale * 0.045, 18]} />
        <meshStandardMaterial color="#0a0f16" roughness={0.98} metalness={0.08} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, scale * 0.048, 0]}>
        <ringGeometry args={[scale * 0.34, scale * 0.39, 36]} />
        <meshStandardMaterial color="#1b222d" emissive="#8fb8d0" emissiveIntensity={0.045} roughness={0.82} />
      </mesh>

      {layout.districts.map((district) => (
        <group key={`district-${district.id}`}>
          <mesh
            position={[district.x / 2, scale * 0.052, district.z / 2]}
            rotation={[0, -district.rotation, 0]}
          >
            <boxGeometry args={[Math.hypot(district.x, district.z), scale * 0.018, scale * 0.045]} />
            <meshStandardMaterial color="#1a2028" roughness={0.9} metalness={0.12} />
          </mesh>
          <mesh position={[district.x, scale * 0.056, district.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[scale * 0.16, scale * 0.195, 24]} />
            <meshStandardMaterial color="#202935" emissive="#557d93" emissiveIntensity={0.035} roughness={0.86} />
          </mesh>
        </group>
      ))}

      {layout.buildings.map((building) => (
        <group key={building.id} position={[building.x, scale * 0.06, building.z]} rotation={[0, building.rotation, 0]}>
          <mesh position={[0, building.height / 2, 0]}>
            {building.shape === 'round' ? (
              <cylinderGeometry args={[building.width * 0.52, building.width * 0.62, building.height, 8]} />
            ) : (
              <boxGeometry args={[building.width, building.height, building.depth]} />
            )}
            <meshStandardMaterial color="#080d13" roughness={0.7} metalness={0.26} />
          </mesh>

          {building.roof === 'dome' && (
            <mesh position={[0, building.height + building.width * 0.12, 0]}>
              <sphereGeometry args={[building.width * 0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial
                color="#192430"
                emissive={building.cool ? '#5fbbdc' : '#d9985a'}
                emissiveIntensity={selected ? 0.24 : 0.11}
                roughness={0.46}
                metalness={0.35}
              />
            </mesh>
          )}

          {building.roof === 'spire' && (
            <mesh position={[0, building.height + building.width * 0.22, 0]}>
              <coneGeometry args={[building.width * 0.16, building.width * 0.44, 6]} />
              <meshBasicMaterial color={building.cool ? '#6fd8ff' : '#ffc06f'} transparent opacity={selected ? 0.9 : 0.56} toneMapped={false} />
            </mesh>
          )}

          {building.roof === 'flat' && (
            <mesh position={[0, building.height + scale * 0.012, 0]}>
              <boxGeometry args={[building.width * 0.62, scale * 0.018, building.depth * 0.62]} />
              <meshBasicMaterial color={building.cool ? '#67c9ea' : '#e9a25c'} transparent opacity={selected ? 0.72 : 0.38} toneMapped={false} />
            </mesh>
          )}

          <mesh position={[0, building.height * 0.58, building.depth * 0.505]}>
            <boxGeometry args={[building.width * 0.56, scale * 0.012, scale * 0.008]} />
            <meshBasicMaterial color={building.cool ? '#70d8ff' : '#ffbf72'} transparent opacity={selected ? 0.9 : 0.5} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {layout.pads.map((pad) => (
        <group key={`pad-${pad.id}`} position={[pad.x, scale * 0.055, pad.z]} rotation={[0, pad.rotation, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[scale * 0.14, 16]} />
            <meshStandardMaterial color="#111820" roughness={0.7} metalness={0.36} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, scale * 0.006, 0]}>
            <ringGeometry args={[scale * 0.09, scale * 0.115, 20]} />
            <meshBasicMaterial color="#79d8f7" transparent opacity={selected ? 0.7 : 0.28} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, scale * 0.42, 0]}>
        <cylinderGeometry args={[scale * 0.035, scale * 0.055, scale * 0.72, 8]} />
        <meshStandardMaterial color="#2c3947" metalness={0.64} roughness={0.3} />
      </mesh>
      <mesh position={[0, scale * 0.8, 0]}>
        <sphereGeometry args={[scale * 0.055, 10, 10]} />
        <meshBasicMaterial color="#9de7ff" transparent opacity={selected ? 0.9 : 0.48} toneMapped={false} />
      </mesh>

      <pointLight
        position={[0, scale * 0.62, 0]}
        color="#ffc17c"
        intensity={selected ? 1.05 : 0.4}
        distance={scale * 4.2}
        decay={2}
      />
    </group>
  )
}

function WaterSettlementFeature({ scale, selected, seed }: { scale: number; selected: boolean; seed: number }) {
  const layout = useMemo(() => {
    const random = seededRandom(seed ^ 0x53a9)
    const platforms = Array.from({ length: 9 }, (_, index) => {
      const angle = (index / 9) * Math.PI * 2 + (random() - 0.5) * 0.26
      const distance = scale * (0.28 + random() * 0.38)
      return {
        id: index,
        angle,
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        radius: scale * (0.07 + random() * 0.07),
        height: scale * (0.08 + random() * 0.2),
        tower: random() > 0.58,
        dome: random() > 0.72,
        cool: random() > 0.45,
      }
    })

    const pontoons = Array.from({ length: 3 }, (_, index) => {
      const angle = index * ((Math.PI * 2) / 3) + random() * 0.3
      const distance = scale * (0.58 + random() * 0.1)
      return {
        id: index,
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        angle,
      }
    })

    return { platforms, pontoons }
  }, [scale, seed])

  return (
    <group>
      <mesh position={[0, scale * 0.04, 0]}>
        <cylinderGeometry args={[scale * 0.28, scale * 0.34, scale * 0.08, 14]} />
        <meshStandardMaterial color="#0c141d" roughness={0.56} metalness={0.56} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, scale * 0.086, 0]}>
        <ringGeometry args={[scale * 0.11, scale * 0.16, 24]} />
        <meshStandardMaterial color="#172635" emissive="#62c7e8" emissiveIntensity={selected ? 0.16 : 0.055} roughness={0.5} metalness={0.42} />
      </mesh>
      <mesh position={[0, scale * 0.26, 0]}>
        <cylinderGeometry args={[scale * 0.055, scale * 0.09, scale * 0.42, 8]} />
        <meshStandardMaterial color="#1a2632" emissive="#67d9ff" emissiveIntensity={selected ? 0.24 : 0.08} metalness={0.48} />
      </mesh>

      {layout.platforms.map((platform) => (
        <group key={platform.id}>
          <mesh
            position={[platform.x / 2, scale * 0.055, platform.z / 2]}
            rotation={[0, -platform.angle, 0]}
          >
            <boxGeometry args={[Math.hypot(platform.x, platform.z), scale * 0.022, scale * 0.035]} />
            <meshStandardMaterial color="#1d2731" emissive="#4e95ab" emissiveIntensity={0.025} metalness={0.44} roughness={0.54} />
          </mesh>

          <mesh position={[platform.x, platform.height / 2 + scale * 0.035, platform.z]}>
            <cylinderGeometry args={[platform.radius, platform.radius * 1.12, platform.height, 10]} />
            <meshStandardMaterial color="#0a1219" roughness={0.62} metalness={0.5} />
          </mesh>

          {platform.tower && (
            <mesh position={[platform.x, platform.height + scale * 0.11, platform.z]}>
              <cylinderGeometry args={[platform.radius * 0.22, platform.radius * 0.34, scale * 0.2, 7]} />
              <meshStandardMaterial color="#162534" metalness={0.5} roughness={0.48} />
            </mesh>
          )}

          {platform.dome && (
            <mesh position={[platform.x, platform.height + scale * 0.075, platform.z]}>
              <sphereGeometry args={[platform.radius * 0.58, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial
                color="#18303b"
                emissive={platform.cool ? '#5cb9da' : '#d99b57'}
                emissiveIntensity={selected ? 0.18 : 0.075}
                roughness={0.38}
                metalness={0.3}
              />
            </mesh>
          )}

          <mesh position={[platform.x, platform.height + scale * 0.045, platform.z]}>
            <sphereGeometry args={[scale * 0.022, 8, 8]} />
            <meshBasicMaterial
              color={platform.cool ? '#71ddff' : '#ffc270'}
              transparent
              opacity={selected ? 0.86 : 0.46}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {layout.pontoons.map((pontoon) => (
        <group key={`pontoon-${pontoon.id}`} position={[pontoon.x, scale * 0.045, pontoon.z]} rotation={[0, pontoon.angle, 0]}>
          <mesh>
            <boxGeometry args={[scale * 0.2, scale * 0.045, scale * 0.095]} />
            <meshStandardMaterial color="#101a23" metalness={0.5} roughness={0.55} />
          </mesh>
          <mesh position={[scale * 0.075, scale * 0.035, 0]}>
            <boxGeometry args={[scale * 0.018, scale * 0.07, scale * 0.018]} />
            <meshBasicMaterial color="#69d2f0" transparent opacity={selected ? 0.72 : 0.36} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <pointLight
        position={[0, scale * 0.45, 0]}
        color="#79ddff"
        intensity={selected ? 1.15 : 0.44}
        distance={scale * 4.5}
        decay={2}
      />
    </group>
  )
}

function VaultFeature({ scale, selected }: { scale: number; selected: boolean }) {
  return (
    <group>
      <mesh position={[0, scale * 0.34, 0]}>
        <boxGeometry args={[scale * 1.9, scale * 0.68, scale * 1.35]} />
        <meshStandardMaterial color="#252734" metalness={0.68} roughness={0.5} />
      </mesh>
      <mesh position={[0, scale * 0.34, scale * 0.69]}>
        <boxGeometry args={[scale * 0.72, scale * 0.52, scale * 0.08]} />
        <meshStandardMaterial color="#080b12" emissive="#b863ff" emissiveIntensity={selected ? 1.3 : 0.72} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[scale * x, scale * 0.76, 0]}>
          <cylinderGeometry args={[scale * 0.08, scale * 0.13, scale * 0.72, 8]} />
          <meshBasicMaterial color="#c780ff" toneMapped={false} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, scale * 0.94, 0]}>
        <torusGeometry args={[scale * 1.05, scale * 0.08, 10, 48]} />
        <meshBasicMaterial color="#b968ff" transparent opacity={0.78} toneMapped={false} />
      </mesh>
      <pointLight position={[0, scale * 0.9, scale * 0.5]} color="#bd68ff" intensity={selected ? 9 : 5} distance={scale * 13} />
    </group>
  )
}

function GenericAnomalyFeature({ scale, selected }: { scale: number; selected: boolean }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, scale * 0.025, 0]}>
        <torusGeometry args={[scale * 0.95, scale * 0.1, 14, 56]} />
        <meshStandardMaterial color="#3b1d48" emissive="#b657d0" emissiveIntensity={selected ? 0.95 : 0.55} roughness={0.7} />
      </mesh>
      <mesh position={[0, scale * 0.28, 0]}>
        <octahedronGeometry args={[scale * 0.46, 1]} />
        <meshStandardMaterial color="#25142d" emissive="#a34dba" emissiveIntensity={selected ? 0.7 : 0.38} roughness={0.5} metalness={0.18} />
      </mesh>
      <pointLight position={[0, scale * 0.2, 0]} color="#b45bcc" intensity={selected ? 3.2 : 1.6} distance={scale * 6} />
    </group>
  )
}

function ResourceFeature({ scale, selected }: { scale: number; selected: boolean }) {
  return (
    <group>
      {[-0.72, -0.28, 0.18, 0.64].map((x, index) => (
        <mesh key={x} position={[scale * x, scale * (0.5 + index * 0.13), scale * (index % 2 === 0 ? 0.22 : -0.18)]}>
          <coneGeometry args={[scale * 0.22, scale * (1.05 + index * 0.16), 6]} />
          <meshStandardMaterial color="#63ffb2" emissive="#27ff93" emissiveIntensity={selected ? 1.45 : 0.8} roughness={0.23} />
        </mesh>
      ))}
      <pointLight position={[0, scale * 0.85, 0]} color="#42ffa3" intensity={selected ? 8 : 4.5} distance={scale * 12} />
    </group>
  )
}

function MissionFeature({ scale, selected }: { scale: number; selected: boolean }) {
  return (
    <group>
      <mesh position={[0, scale * 0.74, 0]}>
        <cylinderGeometry args={[scale * 0.09, scale * 0.18, scale * 1.48, 8]} />
        <meshStandardMaterial color="#9aabc4" metalness={0.75} roughness={0.28} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, scale * 1.52, 0]}>
        <torusGeometry args={[scale * 0.54, scale * 0.07, 12, 40]} />
        <meshBasicMaterial color="#66e7ff" toneMapped={false} />
      </mesh>
      <mesh position={[0, scale * 1.52, 0]}>
        <sphereGeometry args={[scale * 0.14, 12, 12]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <pointLight position={[0, scale * 1.45, 0]} color="#66e7ff" intensity={selected ? 8 : 4} distance={scale * 12} />
    </group>
  )
}

function resolveSurfaceVisual(point: SurfacePoint, isOcean: boolean): SurfaceVisualType {
  if (point.visualType) return point.visualType
  if (point.kind === 'settlement') return isOcean ? 'settlement-water' : 'settlement-land'
  if (point.kind === 'anomaly' && point.label.toLowerCase().includes('vault')) return 'vault'
  return point.kind
}

function SurfaceFeature({
  point,
  planet,
  seedKey,
  radius,
  selected,
}: {
  point: SurfacePoint
  planet: Planet
  seedKey: string
  radius: number
  selected: boolean
}) {
  const surfaceInfo = useMemo(
    () => samplePlanetSurfaceInfo(planet, seedKey, point.latitude, point.longitude, radius),
    [planet, point.latitude, point.longitude, radius, seedKey],
  )
  const visualType = resolveSurfaceVisual(point, surfaceInfo.isOcean)
  const isSettlement = visualType === 'settlement-land' || visualType === 'settlement-water'
  const backendScale = THREE.MathUtils.clamp(point.visualScale ?? 1, 0.35, 2)
  const featureScale = (isSettlement
    ? THREE.MathUtils.clamp(radius * 0.082, 0.13, 0.28)
    : THREE.MathUtils.clamp(radius * 0.085, 0.14, 0.3)) * backendScale
  const { position, quaternion } = useMemo(
    () => surfaceTransform(point, surfaceInfo.radius + featureScale * 0.012),
    [featureScale, point, surfaceInfo.radius],
  )
  const featureSeed = hashSeed(`${seedKey}:${point.id}:${visualType}`)

  return (
    <group position={position.toArray()} quaternion={quaternion}>
      {visualType === 'settlement-land' && <LandSettlementFeature scale={featureScale} selected={selected} seed={featureSeed} />}
      {visualType === 'settlement-water' && <WaterSettlementFeature scale={featureScale} selected={selected} seed={featureSeed} />}
      {visualType === 'vault' && <VaultFeature scale={featureScale} selected={selected} />}
      {visualType === 'anomaly' && <GenericAnomalyFeature scale={featureScale} selected={selected} />}
      {visualType === 'resource' && <ResourceFeature scale={featureScale} selected={selected} />}
      {visualType === 'mission' && <MissionFeature scale={featureScale} selected={selected} />}
    </group>
  )
}

function SurfaceMarker({ point, planet, seedKey, radius, selected, onSelect }: {
  point: SurfacePoint
  planet: Planet
  seedKey: string
  radius: number
  selected: boolean
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const position = useMemo(() => {
    const surfaceRadius = samplePlanetSurfaceRadius(planet, seedKey, point.latitude, point.longitude, radius)
    return latLonToVector3(point.latitude, point.longitude, surfaceRadius * 1.008)
  }, [planet, point.latitude, point.longitude, radius, seedKey])
  const lineEnd = useMemo(() => {
    const vector = new THREE.Vector3(...position).normalize().multiplyScalar(radius * 1.48)
    return vector.toArray() as [number, number, number]
  }, [position, radius])

  return (
    <group>
      <Line points={[position, lineEnd]} color={selected ? '#ffffff' : '#66e7ff'} lineWidth={1.3} transparent opacity={0.72} />
      <mesh
        position={lineEnd}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        <sphereGeometry args={[selected || hovered ? 0.1 : 0.072, 18, 18]} />
        <meshBasicMaterial color={selected ? '#ffffff' : '#66e7ff'} toneMapped={false} depthTest={false} />
      </mesh>
      {(hovered || selected) && (
        <Html position={lineEnd} center distanceFactor={7} style={{ pointerEvents: 'none' }}>
          <div className="surface-label">
            <strong>{point.label}</strong>
            <span>{point.kind}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

function LatitudeBands({ radius }: { radius: number }) {
  const lines = useMemo(() => {
    return [-45, 0, 45].map((latitude) => {
      const y = Math.sin(THREE.MathUtils.degToRad(latitude)) * radius * 1.018
      const ringRadius = Math.cos(THREE.MathUtils.degToRad(latitude)) * radius * 1.018
      return Array.from({ length: 65 }, (_, index) => {
        const angle = (index / 64) * Math.PI * 2
        return [Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius] as [number, number, number]
      })
    })
  }, [radius])

  return (
    <>
      {lines.map((points, index) => (
        <Line key={index} points={points} color="#9ed9ff" lineWidth={0.55} transparent opacity={0.16} />
      ))}
    </>
  )
}

function getInspectionPrimaryLayout(system: StarSystem, planet: Planet) {
  const direction = new THREE.Vector3(-0.12, 0.04, -1).normalize()
  const distance = THREE.MathUtils.clamp(72 + planet.orbitRadius * 16, 120, 220)
  const primaryRadius = getSystemPrimaryRadius(system)
  const angularRadius = THREE.MathUtils.clamp(
    (primaryRadius / Math.max(planet.orbitRadius, 0.1)) * 0.16,
    0.018,
    0.065,
  )
  const visualRadius = distance * angularRadius

  return {
    position: direction.multiplyScalar(distance),
    distance,
    visualRadius,
    scale: visualRadius / Math.max(primaryRadius, 0.001),
  }
}

function InspectionPrimary({ system, planet }: { system: StarSystem; planet: Planet }) {
  const layout = useMemo(() => getInspectionPrimaryLayout(system, planet), [planet, system])
  return (
    <group position={layout.position.toArray()}>
      <SystemPrimaryVisual system={system} scale={layout.scale} detail="inspection" />
    </group>
  )
}

function ColonyPod({
  planet,
  seedKey,
  radius,
  sequence,
  onImpact,
}: {
  planet: Planet
  seedKey: string
  radius: number
  sequence: number
  onImpact: () => void
}) {
  const pod = useRef<THREE.Group>(null)
  const impactRing = useRef<THREE.Mesh>(null)
  const impactMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const impactLight = useRef<THREE.PointLight>(null)
  const elapsed = useRef(0)
  const impacted = useRef(false)
  const duration = 0.68
  const impactDuration = 0.22
  const landingLatitude = 18
  const landingLongitude = -28

  const path = useMemo(() => {
    const surfaceRadius = samplePlanetSurfaceRadius(planet, seedKey, landingLatitude, landingLongitude, radius)
    const target = new THREE.Vector3(...latLonToVector3(landingLatitude, landingLongitude, surfaceRadius * 1.012))
    const normal = target.clone().normalize()
    const tangent = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0))
    if (tangent.lengthSq() < 0.001) tangent.crossVectors(normal, new THREE.Vector3(1, 0, 0))
    tangent.normalize()
    const start = target.clone().addScaledVector(normal, radius * 3.3).addScaledVector(tangent, radius * 1.7)
    const control = target.clone().addScaledVector(normal, radius * 1.55).addScaledVector(tangent, radius * 0.42)
    return {
      target,
      normal,
      curve: new THREE.QuadraticBezierCurve3(start, control, target.clone().addScaledVector(normal, radius * 0.035)),
    }
  }, [planet, radius, seedKey])

  useFrame((_, delta) => {
    elapsed.current += delta
    const flight = THREE.MathUtils.clamp(elapsed.current / duration, 0, 1)
    const eased = flight * flight * (3 - 2 * flight)

    if (pod.current) {
      const position = path.curve.getPoint(eased)
      const direction = path.curve.getTangent(Math.min(0.999, eased + 0.001)).normalize()
      pod.current.position.copy(position)
      pod.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction)
      pod.current.visible = elapsed.current < duration + impactDuration
    }

    if (flight >= 1 && !impacted.current) {
      impacted.current = true
      onImpact()
    }

    const impactProgress = THREE.MathUtils.clamp((elapsed.current - duration) / impactDuration, 0, 1)
    if (impactRing.current) {
      impactRing.current.position.copy(path.target.clone().addScaledVector(path.normal, radius * 0.025))
      impactRing.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), path.normal)
      impactRing.current.scale.setScalar(0.35 + impactProgress * 2.5)
      impactRing.current.visible = impactProgress > 0 && impactProgress < 1
    }
    if (impactMaterial.current) impactMaterial.current.opacity = (1 - impactProgress) * 0.88
    if (impactLight.current) {
      impactLight.current.position.copy(path.target.clone().addScaledVector(path.normal, radius * 0.14))
      impactLight.current.intensity = impactProgress > 0 && impactProgress < 1 ? (1 - impactProgress) * 5.5 : 0
    }
  })

  if (sequence <= 0) return null

  const podScale = THREE.MathUtils.clamp(radius * 0.085, 0.12, 0.24)

  return (
    <group>
      <group ref={pod}>
        <mesh>
          <capsuleGeometry args={[podScale * 0.34, podScale * 0.9, 8, 12]} />
          <meshStandardMaterial color="#d7e1ec" metalness={0.72} roughness={0.26} />
        </mesh>
        <mesh position={[0, podScale * 0.68, 0]}>
          <coneGeometry args={[podScale * 0.23, podScale * 0.52, 10]} />
          <meshStandardMaterial color="#536477" metalness={0.78} roughness={0.24} />
        </mesh>
        <mesh position={[0, -podScale * 0.68, 0]}>
          <coneGeometry args={[podScale * 0.28, podScale * 0.72, 10]} />
          <meshBasicMaterial color="#ffb65c" transparent opacity={0.82} toneMapped={false} />
        </mesh>
        <pointLight color="#ffb35b" intensity={2.8} distance={podScale * 9} decay={2} />
      </group>
      <mesh ref={impactRing} visible={false}>
        <ringGeometry args={[podScale * 0.58, podScale * 0.82, 48]} />
        <meshBasicMaterial ref={impactMaterial} color="#ffd58d" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight ref={impactLight} color="#ffd18a" intensity={0} distance={radius * 2.2} decay={2} />
    </group>
  )
}

export function PlanetScene({
  system,
  planet,
  seedKey,
  selectedPointId,
  colonizationSequence,
  onColonizationImpact,
  onSelectPoint,
}: {
  system: StarSystem
  planet: Planet
  seedKey: string
  selectedPointId?: string
  colonizationSequence: number
  onColonizationImpact: () => void
  onSelectPoint: (point?: SurfacePoint) => void
}) {
  const spinGroup = useRef<THREE.Group>(null)
  const [focusedMoon, setFocusedMoon] = useState<MoonFocusTarget>()
  const tidallyLocked = planet.tidallyLocked ?? planet.type.toLowerCase().includes('tidally locked')
  const inspectionPrimaryLayout = useMemo(() => getInspectionPrimaryLayout(system, planet), [planet, system])
  const lockedInspectionYaw = useMemo(() => {
    // The procedural climate uses texture-space +X as the substellar point.
    // Three.js SphereGeometry displays that longitude on mesh-local -X, so
    // rotate local -X—not +X—toward the inspection sun. Convert the sun into
    // the tilted planet frame first so the visual day side and climate agree.
    const tilt = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.08, 0, THREE.MathUtils.degToRad(planet.axialTilt)),
    )
    const localSunDirection = inspectionPrimaryLayout.position
      .clone()
      .normalize()
      .applyQuaternion(tilt.invert())
    return yawForSubstellarMeshAxis(localSunDirection.x, localSunDirection.z)
  }, [inspectionPrimaryLayout, planet.axialTilt])
  const radius = planet.radius * 2.25
  const inspectionLensingRadius = isBlackHoleSystem(system)
    ? (system.blackHole?.accretionDisk?.outerRadius ?? getSystemPrimaryRadius(system) * 4)
      * inspectionPrimaryLayout.scale
      * (system.blackHole?.lensingRadiusMultiplier ?? (isGalacticCoreSystem(system) ? 1.18 : 1.0))
    : 0
  const inspectionLensingStrength = system.blackHole?.lensingStrength
    ?? (isGalacticCoreSystem(system) ? 1.32 : 0.92)
  const urbanLights = useMemo(() => buildUrbanLightSites(planet, seedKey, radius), [planet, radius, seedKey])

  useFrame((_, delta) => {
    if (spinGroup.current && !tidallyLocked) spinGroup.current.rotation.y += delta * 0.065
  })

  return (
    <group>
      {isBlackHoleSystem(system) && (
        <BlackHoleLensingPass
          worldPosition={inspectionPrimaryLayout.position.toArray() as [number, number, number]}
          influenceRadius={inspectionLensingRadius}
          strength={inspectionLensingStrength}
        />
      )}
      <InspectionPrimary system={system} planet={planet} />
      <ambientLight intensity={0.2} />
      <hemisphereLight color="#cbdcff" groundColor="#090d19" intensity={0.38} />
      <group
        rotation={[0.08, 0, THREE.MathUtils.degToRad(planet.axialTilt)]}
        userData={{ blackHoleLensingBody: true }}
      >
        <group ref={spinGroup} rotation={[0, tidallyLocked ? lockedInspectionYaw : 0, 0]}>
          <group
            onClick={(event) => {
              event.stopPropagation()
              setFocusedMoon(undefined)
              onSelectPoint(undefined)
            }}
          >
            <ProceduralPlanet planet={planet} seedKey={seedKey} detail="detail" radius={radius} />
          </group>
          <LatitudeBands radius={radius} />
          {urbanLights.map((light) => (
            <pointLight
              key={light.id}
              position={light.position}
              color={light.color}
              intensity={light.intensity}
              distance={light.distance}
              decay={2}
            />
          ))}
          {colonizationSequence > 0 && (
            <ColonyPod
              key={colonizationSequence}
              planet={planet}
              seedKey={seedKey}
              radius={radius}
              sequence={colonizationSequence}
              onImpact={onColonizationImpact}
            />
          )}
          {planet.surfacePoints.map((point) => (
            <group key={point.id}>
              <SurfaceFeature
                point={point}
                planet={planet}
                seedKey={seedKey}
                radius={radius}
                selected={selectedPointId === point.id}
              />
              <SurfaceMarker
                point={point}
                planet={planet}
                seedKey={seedKey}
                radius={radius}
                selected={selectedPointId === point.id}
                onSelect={() => onSelectPoint(point)}
              />
            </group>
          ))}
        </group>
        <PlanetRings planet={planet} radius={radius} />
      </group>
      <MoonSystem
        moons={planet.moons}
        parentRadius={radius}
        mode="inspection"
        focusedMoonId={focusedMoon?.id}
        onFocusMoon={setFocusedMoon}
      />
      <MoonFocusController
        focus={focusedMoon}
        onClear={() => setFocusedMoon(undefined)}
        distanceMultiplier={8}
      />
      <directionalLight position={inspectionPrimaryLayout.position.toArray()} intensity={5.1} color={getSystemPrimaryColor(system)} />
      <pointLight position={[-5, -2, -4]} intensity={1.7} color="#4d79ff" />
    </group>
  )
}

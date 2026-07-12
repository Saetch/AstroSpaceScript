import { Html, useCursor } from '@react-three/drei'
import { ThreeEvent, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Galaxy } from '../domain/universe'
import { buildGalaxyInteractionStreams, buildGalaxyPointGeometry, galaxyGroupExtent, getGalaxyBodies } from '../procedural/galaxyGeometry'

function InteractionStreams({ galaxy, hovered }: { galaxy: Galaxy; hovered: boolean }) {
  const streams = useMemo(() => buildGalaxyInteractionStreams(galaxy, 1, 3600), [galaxy])

  useEffect(() => () => {
    streams.forEach((stream) => stream.geometry.dispose())
  }, [streams])

  return (
    <group>
      {streams.map((stream) => (
        <points key={stream.id} geometry={stream.geometry} frustumCulled={false} renderOrder={2}>
          <pointsMaterial
            size={hovered ? stream.size * 1.35 : stream.size}
            sizeAttenuation={false}
            vertexColors
            transparent
            opacity={hovered ? Math.min(1, stream.opacity + 0.16) : stream.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      ))}
    </group>
  )
}

function GalaxyBody({ galaxy, body, hovered }: {
  galaxy: Galaxy
  body: ReturnType<typeof getGalaxyBodies>[number]
  hovered: boolean
}) {
  const geometry = useMemo(() => {
    const count = body.morphology === 'elliptical' ? 2600 : body.morphology === 'barred-spiral' ? 5200 : 4200
    return buildGalaxyPointGeometry(body, { count })
  }, [body])

  return (
    <group
      position={body.offset}
      rotation={[body.inclination?.[0] ?? 0, body.rotation, body.inclination?.[2] ?? 0]}
    >
      <points geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          size={hovered ? 1.85 : 1.45}
          sizeAttenuation={false}
          vertexColors
          transparent
          opacity={hovered ? 0.95 : 0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {body.interactionPhase && body.interactionPhase !== 'bound' && (
        <group>
          <mesh scale={[body.radius * 0.16, Math.max(body.thickness * 0.42, 2.5), body.radius * 0.16]}>
            <sphereGeometry args={[1, 32, 20]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={hovered ? 0.2 : 0.13}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[body.radius * 0.34, body.radius * 0.22, 1]}>
            <circleGeometry args={[1, 64]} />
            <meshBasicMaterial
              color={body.primaryColor}
              transparent
              opacity={hovered ? 0.075 : 0.04}
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
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[body.radius * 0.31, body.radius * 0.052, 1]}>
            <circleGeometry args={[1, 64]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={hovered ? 0.12 : 0.065}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh scale={[body.radius * 0.15, body.thickness * 0.22, body.radius * 0.105]}>
            <sphereGeometry args={[1, 32, 20]} />
            <meshBasicMaterial
              color={body.secondaryColor}
              transparent
              opacity={hovered ? 0.17 : 0.095}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {!galaxy.companions?.length && (hovered || (galaxy.home && body.primary)) && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -body.thickness * 0.35, 0]}>
          <ringGeometry args={[body.radius * 1.05, body.radius * 1.09, 128]} />
          <meshBasicMaterial
            color={hovered ? '#ffffff' : body.primaryColor}
            transparent
            opacity={hovered ? 0.7 : 0.42}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  )
}

function GalaxyObject({ galaxy, onOpen }: { galaxy: Galaxy; onOpen: () => void }) {
  const root = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const bodies = useMemo(() => getGalaxyBodies(galaxy), [galaxy])
  const hitRadius = useMemo(() => galaxyGroupExtent(galaxy) * 1.25, [galaxy])
  useCursor(hovered)

  useFrame((_, delta) => {
    if (root.current) root.current.rotation.y += delta * (galaxy.home ? 0.012 : 0.006)
  })

  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(true)
  }

  return (
    <group
      ref={root}
      position={galaxy.position}
      rotation={[0.1, galaxy.rotation, 0]}
      onPointerOver={handlePointer}
      onPointerMove={handlePointer}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
    >
      <InteractionStreams galaxy={galaxy} hovered={hovered} />

      {bodies.map((body) => (
        <GalaxyBody key={body.id} galaxy={galaxy} body={body} hovered={hovered} />
      ))}

      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        onPointerOver={handlePointer}
        onPointerMove={handlePointer}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
      >
        <circleGeometry args={[hitRadius, 128]} />
        <meshBasicMaterial
          color={galaxy.primaryColor}
          transparent
          opacity={0.001}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html center position={[0, galaxy.thickness + 26, 0]} style={{ pointerEvents: 'auto' }}>
        <button
          type="button"
          className={`galaxy-overview-label ${hovered ? 'galaxy-overview-label--active' : ''}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          <span>{galaxy.home ? 'HOME GALAXY' : galaxy.companions?.length ? 'GALAXY GROUP' : galaxy.morphology.toUpperCase()}</span>
          <strong>{galaxy.name}</strong>
          <small>
            {galaxy.estimatedSystems} systems
            {galaxy.companions?.length ? ` · ${galaxy.companions.length + 1} members` : ''}
            {' · open galaxy'}
          </small>
        </button>
      </Html>
    </group>
  )
}

export function GalaxyOverviewScene({ galaxies, onOpenGalaxy }: {
  galaxies: Galaxy[]
  onOpenGalaxy: (galaxyId: string) => void
}) {
  return (
    <group rotation={[0.03, -0.08, 0]}>
      {galaxies.map((galaxy) => (
        <GalaxyObject key={galaxy.id} galaxy={galaxy} onOpen={() => onOpenGalaxy(galaxy.id)} />
      ))}
    </group>
  )
}

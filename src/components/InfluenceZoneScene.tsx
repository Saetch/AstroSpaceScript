import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { StarSystem } from '../domain/universe'
import {
  bodyPositionRelativeTo,
  bodySystemPositionAtTime,
  buildFlightBodies,
  type FlightBody,
} from '../spatial/flightInfluence'
import { getSimulationTimeSeconds } from '../spatial/simulationClock'

function InfluenceSphere({
  body,
  system,
  active,
  renderScale,
  referenceBodyId,
}: {
  body: FlightBody
  system: StarSystem
  active: boolean
  renderScale: number
  referenceBodyId?: string
}) {
  const group = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!group.current) return
    const time = getSimulationTimeSeconds()
    const position = referenceBodyId
      ? bodyPositionRelativeTo(system, body.id, referenceBodyId, time)
      : bodySystemPositionAtTime(system, body.id, time)
    group.current.position.set(
      position[0] * renderScale,
      position[1] * renderScale,
      position[2] * renderScale,
    )
  })

  return (
    <group ref={group}>
      <mesh renderOrder={active ? 720 : 30}>
        <sphereGeometry args={[body.influenceRadius * renderScale, 32, 18]} />
        <meshBasicMaterial
          color={active ? '#78e8ff' : body.kind === 'moon' ? '#c4a6ff' : '#7899bc'}
          transparent
          opacity={active ? 0.095 : body.kind === 'star' ? 0.012 : 0.028}
          wireframe
          toneMapped={false}
          depthWrite={false}
          depthTest={!active}
        />
      </mesh>
      {active && (
        <Html
          center
          position={[0, body.influenceRadius * renderScale, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div className="influence-zone-label">
            <strong>{body.name}</strong>
            <span>INFLUENCE · {body.influenceRadius.toFixed(2)} u</span>
          </div>
        </Html>
      )}
    </group>
  )
}

export function InfluenceZoneScene({
  system,
  activeBodyId,
  renderScale,
  referencePlanetId,
}: {
  system: StarSystem
  activeBodyId?: string
  renderScale: number
  /** When present, render the planet and its moons in planet-local inspection coordinates. */
  referencePlanetId?: string
}) {
  const bodies = useMemo(() => buildFlightBodies(system), [system])
  const visibleBodies = useMemo(() => {
    if (!referencePlanetId) return bodies
    return bodies.filter((body) => body.id === referencePlanetId || body.planetId === referencePlanetId)
  }, [bodies, referencePlanetId])

  return (
    <group>
      {visibleBodies.map((body) => (
        <InfluenceSphere
          key={body.id}
          body={body}
          system={system}
          active={body.id === activeBodyId}
          renderScale={renderScale}
          referenceBodyId={referencePlanetId}
        />
      ))}
    </group>
  )
}

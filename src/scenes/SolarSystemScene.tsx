import { Html, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Planet, StarSystem } from '../domain/universe'
import { BlackHoleLensingPass } from '../components/BlackHoleLensingPass'
import { MoonFocusController, type MoonFocusTarget } from '../components/MoonFocusController'
import { MoonSystem } from '../components/MoonSystem'
import { OrbitRing } from '../components/OrbitRing'
import { PlanetRings, ProceduralPlanet } from '../components/ProceduralPlanet'
import { isBlackHoleSystem, isGalacticCoreSystem, SystemPrimaryVisual } from '../components/SystemPrimary'
import { buildPlanetSeedKey } from '../procedural/planetSeed'
import { yawForSubstellarMeshAxis } from '../procedural/tidalOrientation'
import {
  orbitPositionAtTime,
  planetOrbitDefinition,
  type OrbitDefinition,
} from '../spatial/orbit'
import { getSimulationTimeSeconds } from '../spatial/simulationClock'
import { SYSTEM_UNITS_TO_WORLD } from '../spatial/renderScales'

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
  orbit,
  focusedMoonId,
  onFocusMoon,
  highlighted,
  onHighlight,
  onOpen,
}: {
  planet: Planet
  seedKey: string
  orbit: OrbitDefinition
  focusedMoonId?: string
  onFocusMoon: (target: MoonFocusTarget) => void
  highlighted: boolean
  onHighlight: () => void
  onOpen: () => void
}) {
  const positionGroup = useRef<THREE.Group>(null)
  const tiltGroup = useRef<THREE.Group>(null)
  const spinGroup = useRef<THREE.Group>(null)
  const hitbox = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Mesh>(null)
  const glowMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const selectionHalo = useRef<THREE.Mesh>(null)
  const locatorAnchor = useRef<THREE.Group>(null)
  const worldPosition = useRef(new THREE.Vector3())
  const locatorDirection = useRef(new THREE.Vector3())
  const cameraForward = useRef(new THREE.Vector3())
  const tidallyLocked = planet.tidallyLocked ?? planet.type.toLowerCase().includes('tidally locked')
  const [hovered, setHovered] = useState(false)
  const [locatorVisible, setLocatorVisible] = useState(false)
  const locatorVisibleRef = useRef(false)
  const initialPosition = useMemo(
    () => orbitPositionAtTime(orbit, getSimulationTimeSeconds(), SYSTEM_UNITS_TO_WORLD),
    [orbit],
  )
  const initialStarDirection = useMemo(
    () => new THREE.Vector2(-initialPosition[0], -initialPosition[2]).normalize(),
    [initialPosition],
  )
  useCursor(hovered)

  useFrame((state, delta) => {
    const position = orbitPositionAtTime(
      orbit,
      getSimulationTimeSeconds(),
      SYSTEM_UNITS_TO_WORLD,
    )

    if (positionGroup.current) positionGroup.current.position.set(...position)

    if (spinGroup.current) {
      if (tidallyLocked) {
        const starDirection = new THREE.Vector2(-position[0], -position[2]).normalize()
        spinGroup.current.rotation.y = yawForSubstellarMeshAxis(starDirection.x, starDirection.y)
      } else {
        spinGroup.current.rotation.y += delta * 0.24
      }
    }

    if (positionGroup.current) {
      const cameraDistance = state.camera.position.distanceTo(
        positionGroup.current.getWorldPosition(worldPosition.current),
      )
      const directionToPlanet = locatorDirection.current
        .copy(worldPosition.current)
        .sub(state.camera.position)
      const locatorIsInFront = directionToPlanet.dot(
        state.camera.getWorldDirection(cameraForward.current),
      ) > 0

      if (locatorAnchor.current) {
        locatorAnchor.current.visible = locatorIsInFront
        if (locatorIsInFront) {
          // Keep the HTML helper on the same camera ray as the planet, but at
          // a fixed near-camera depth. Its screen position remains accurate
          // while avoiding far-plane and DOM z-index limits at extreme zoom.
          const locatorDepth = THREE.MathUtils.clamp(
            state.camera.far * 0.002,
            18,
            48,
          )
          locatorAnchor.current.position
            .copy(state.camera.position)
            .addScaledVector(directionToPlanet.normalize(), locatorDepth)
        }
      }

      const perspectiveCamera = state.camera as THREE.PerspectiveCamera
      const pixelsPerWorldUnit = perspectiveCamera.isPerspectiveCamera
        ? state.size.height / (
            2 * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2) *
            Math.max(cameraDistance, 0.001)
          )
        : 1
      const apparentRadius = planet.radius * pixelsPerWorldUnit
      const shouldShowLocator = apparentRadius < 5.5 && cameraDistance > 90

      if (locatorVisibleRef.current !== shouldShowLocator) {
        locatorVisibleRef.current = shouldShowLocator
        setLocatorVisible(shouldShowLocator)
      }

      const highlightedScale = THREE.MathUtils.clamp(6 / Math.max(apparentRadius, 0.25), 1.35, 5)
      const targetVisualScale = highlighted ? highlightedScale : hovered ? 1.12 : 1
      if (tiltGroup.current) {
        tiltGroup.current.scale.setScalar(
          THREE.MathUtils.lerp(tiltGroup.current.scale.x, targetVisualScale, 0.16),
        )
      }

      const hitRadius = THREE.MathUtils.clamp(cameraDistance * 0.018, planet.radius * 1.8, 24)
      const glowRadius = highlighted
        ? THREE.MathUtils.clamp(cameraDistance * 0.014, planet.radius * 2.4, 90)
        : THREE.MathUtils.clamp(cameraDistance * 0.006, planet.radius * 1.35, 7)
      hitbox.current?.scale.setScalar(hitRadius)
      glow.current?.scale.setScalar(glowRadius)

      if (glowMaterial.current) {
        glowMaterial.current.opacity = highlighted ? 0.48 : hovered ? 0.2 : 0.1
      }

      if (selectionHalo.current) {
        const haloRadius = perspectiveCamera.isPerspectiveCamera
          ? THREE.MathUtils.clamp(15 / Math.max(pixelsPerWorldUnit, 0.001), planet.radius * 2.8, 120)
          : planet.radius * 3
        selectionHalo.current.visible = highlighted
        selectionHalo.current.scale.setScalar(haloRadius)
        selectionHalo.current.quaternion.copy(state.camera.quaternion)
      }
    }
  })

  return (
    <>
      <group
        ref={positionGroup}
        userData={{ blackHoleLensingBody: true }}
        position={initialPosition}
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
              ? yawForSubstellarMeshAxis(initialStarDirection.x, initialStarDirection.y)
              : 0,
            0,
          ]}
        >
          <ProceduralPlanet planet={planet} seedKey={seedKey} radius={planet.radius} detail="system" />
        </group>
        <PlanetRings planet={planet} radius={planet.radius} detail="system" />
        <mesh ref={glow} raycast={() => null}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial
            ref={glowMaterial}
            color={planet.color}
            transparent
            opacity={hovered ? 0.2 : 0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.BackSide}
          />
        </mesh>
        <mesh
          ref={hitbox}
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
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>

      <mesh ref={selectionHalo} visible={false} raycast={() => null} renderOrder={12}>
        <ringGeometry args={[0.72, 1, 48]} />
        <meshBasicMaterial
          color="#d9fbff"
          transparent
          opacity={0.92}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

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

      <group ref={locatorAnchor} frustumCulled={false}>
        {locatorVisible && (
          <Html
            center
            zIndexRange={[80, 0]}
            style={{ pointerEvents: 'auto', userSelect: 'none' }}
          >
            <button
              type="button"
              draggable={false}
              className={`planet-locator ${highlighted ? 'planet-locator--active' : ''}`}
              title={`Highlight ${planet.name}`}
              aria-label={`Highlight ${planet.name} and its orbit`}
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                onHighlight()
              }}
            >
              <span className="planet-locator__name">{planet.name}</span>
              <span className="planet-locator__arrow" aria-hidden="true">▼</span>
            </button>
          </Html>
        )}
      </group>
    </>
  )
}

export function SolarSystemScene({
  system,
  onOpenPlanet,
}: {
  system: StarSystem
  onOpenPlanet: (id: string) => void
}) {
  const [focusedMoon, setFocusedMoon] = useState<MoonFocusTarget>()
  const [highlightedPlanetId, setHighlightedPlanetId] = useState<string>()
  const primaryScale = isGalacticCoreSystem(system) ? 3.625 : 1
  const lensingInfluenceRadius = (
    (system.blackHole?.accretionDisk?.outerRadius ?? system.starRadius * 4) * primaryScale
  ) * (system.blackHole?.lensingRadiusMultiplier ?? (isGalacticCoreSystem(system) ? 1.08 : 0.9))
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
      <group>
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

        {system.planets.map((planet, planetIndex) => {
          const orbit = planetOrbitDefinition(planet)
          return (
            <group key={planet.id}>
              <OrbitRing
                orbit={orbit}
                renderScale={SYSTEM_UNITS_TO_WORLD}
                color={highlightedPlanetId === planet.id ? '#b8f5ff' : '#526083'}
                opacity={highlightedPlanetId === planet.id ? 0.96 : 0.3}
                lineWidth={highlightedPlanetId === planet.id ? 2.2 : 0.7}
                emphasized={highlightedPlanetId === planet.id}
              />
              <OrbitingPlanet
                planet={planet}
                seedKey={buildPlanetSeedKey(system.position, planet.orbitIndex ?? planetIndex)}
                orbit={orbit}
                focusedMoonId={focusedMoon?.id}
                onFocusMoon={setFocusedMoon}
                highlighted={highlightedPlanetId === planet.id}
                onHighlight={() => setHighlightedPlanetId((current) => (
                  current === planet.id ? undefined : planet.id
                ))}
                onOpen={() => onOpenPlanet(planet.id)}
              />
            </group>
          )
        })}

        <MoonFocusController
          focus={focusedMoon}
          onClear={() => setFocusedMoon(undefined)}
          distanceMultiplier={9.5}
        />
      </group>
    </>
  )
}

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AccretionDiskConfig, StarSystem } from '../domain/universe'

export function isGalacticCoreSystem(system: StarSystem) {
  return system.mapRole === 'galactic-core'
}

export function isBlackHoleSystem(system: StarSystem) {
  return system.primaryKind === 'black-hole' || Boolean(system.blackHole)
}

export function getSystemPrimaryColor(system: StarSystem) {
  if (isBlackHoleSystem(system)) {
    return system.blackHole?.accretionDisk?.innerColor ?? system.blackHole?.photonRingColor ?? system.starColor
  }
  return system.starColor
}

export function getSystemPrimaryRadius(system: StarSystem) {
  if (isBlackHoleSystem(system)) return system.blackHole?.eventHorizonRadius ?? system.starRadius
  return system.starRadius
}

export function getSystemPrimaryLabel(system: StarSystem) {
  if (!isBlackHoleSystem(system)) return system.spectralType
  const mass = system.blackHole?.massSolar
  return mass ? `${mass.toLocaleString('en')} M☉ black hole` : system.spectralType
}

function AccretionDisk({ config, scale, detail, animationScale = 1 }: { config: AccretionDiskConfig; scale: number; detail: 'system' | 'inspection'; animationScale?: number }) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uInnerColor: { value: new THREE.Color(config.innerColor) },
        uOuterColor: { value: new THREE.Color(config.outerColor) },
        uOpacity: { value: config.opacity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uInnerColor;
        uniform vec3 uOuterColor;
        uniform float uOpacity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radius = length(p);
          float angle = atan(p.y, p.x);
          float radial = clamp(radius, 0.0, 1.0);

          float spiralA = sin(angle * 18.0 - radial * 54.0 - uTime * 2.7);
          float spiralB = sin(angle * 31.0 + radial * 71.0 + uTime * 1.45);
          float shear = sin(angle * 6.0 - radial * 18.0 - uTime * 1.1);
          float granular = hash(floor(p * 128.0 + uTime * 1.05));
          float filaments = smoothstep(-0.22, 0.88, spiralA * 0.54 + spiralB * 0.23 + shear * 0.18 + granular * 0.26);
          float innerHeat = pow(1.0 - radial, 2.65);
          float hotRing = exp(-pow((radial - 0.18) * 8.0, 2.0));
          float edgeFade = smoothstep(0.01, 0.10, radial) * (1.0 - smoothstep(0.94, 1.0, radial));

          vec3 color = mix(uInnerColor, uOuterColor, smoothstep(0.06, 0.96, pow(radial, 0.82)));
          color *= 0.42 + filaments * 0.92 + innerHeat * 0.95 + hotRing * 1.4;

          float alpha = edgeFade * uOpacity * (0.24 + filaments * 0.56 + hotRing * 0.3);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    })
  }, [config.innerColor, config.opacity, config.outerColor])

  const rimMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: config.outerColor,
    transparent: true,
    opacity: Math.min(0.34, config.opacity * 0.28),
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  }), [config.opacity, config.outerColor])

  const innerRimMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: config.innerColor,
    transparent: true,
    opacity: Math.min(0.48, config.opacity * 0.38),
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  }), [config.innerColor, config.opacity])

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta * config.rotationSpeed * animationScale
  })

  const rotation: [number, number, number] = [
    Math.PI / 2 + config.tilt[0],
    config.tilt[1],
    config.tilt[2],
  ]
  const halfThickness = Math.max(0.02, config.thickness * scale * 0.5)
  const innerRadius = config.innerRadius * scale
  const outerRadius = config.outerRadius * scale
  const radialSegments = detail === 'inspection' ? 256 : 160

  return (
    <group rotation={rotation} userData={{ blackHoleLensedSource: true }}>
      <mesh material={material} renderOrder={4} position={[0, 0, halfThickness]}>
        <ringGeometry args={[innerRadius, outerRadius, radialSegments, 1]} />
      </mesh>
      <mesh material={material} renderOrder={4} position={[0, 0, -halfThickness]}>
        <ringGeometry args={[innerRadius, outerRadius, radialSegments, 1]} />
      </mesh>
      <mesh material={rimMaterial} renderOrder={4} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[outerRadius, outerRadius, halfThickness * 2, detail === 'inspection' ? 96 : 64, 1, true]} />
      </mesh>
      <mesh material={innerRimMaterial} renderOrder={4} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[innerRadius, innerRadius, halfThickness * 2, detail === 'inspection' ? 96 : 64, 1, true]} />
      </mesh>
    </group>
  )
}


function BlackHoleVisual({ system, scale, detail, animationScale = 1 }: { system: StarSystem; scale: number; detail: 'system' | 'inspection'; animationScale?: number }) {
  const config = system.blackHole
  const horizon = (config?.eventHorizonRadius ?? system.starRadius) * scale
  const disk = config?.accretionDisk
  const jetLength = (config?.jetLength ?? 0) * scale
  const jetIntensity = config?.jetIntensity ?? 0
  const jetColor = config?.jetColor ?? '#8fd8ff'
  const showJets = false
  const tilt: [number, number, number] = disk
    ? [Math.PI / 2 + disk.tilt[0], disk.tilt[1], disk.tilt[2]]
    : [Math.PI / 2, 0, 0]

  return (
    <group>
      {disk && <AccretionDisk config={disk} scale={scale} detail={detail} animationScale={animationScale} />}

      {disk && (
        <pointLight
          color={disk.innerColor}
          intensity={Math.max(4, disk.luminosity * (detail === 'inspection' ? 42 : 30))}
          distance={disk.outerRadius * scale * 9}
          decay={1.55}
        />
      )}

      <group userData={{ blackHoleForeground: true }}>
        <mesh renderOrder={8}>
          <sphereGeometry args={[horizon, detail === 'inspection' ? 96 : 64, detail === 'inspection' ? 96 : 64]} />
          <meshBasicMaterial color="#000000" transparent={false} depthWrite depthTest toneMapped={false} fog={false} />
        </mesh>

        {showJets && (
          <group rotation={tilt}>
            {[1, -1].map((direction) => (
              <group key={direction} position={[0, 0, direction * jetLength * 0.5]} rotation={[direction > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0]}>
                <mesh renderOrder={5}>
                  <coneGeometry args={[horizon * 0.34, jetLength, 24, 1, true]} />
                  <meshBasicMaterial
                    color={jetColor}
                    transparent
                    opacity={0.08 * jetIntensity}
                    toneMapped={false}
                    fog={false}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                <mesh renderOrder={5}>
                  <coneGeometry args={[horizon * 0.18, jetLength * 0.88, 20, 1, true]} />
                  <meshBasicMaterial
                    color="#b9edff"
                    transparent
                    opacity={0.12 * jetIntensity}
                    toneMapped={false}
                    fog={false}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                <mesh renderOrder={5} position={[0, jetLength * 0.03, 0]}>
                  <cylinderGeometry args={[horizon * 0.05, horizon * 0.1, jetLength * 0.72, 16, 1, true]} />
                  <meshBasicMaterial
                    color="#e9fbff"
                    transparent
                    opacity={0.16 * jetIntensity}
                    toneMapped={false}
                    fog={false}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            ))}
          </group>
        )}
      </group>
    </group>
  )
}

function StarVisual({ system, scale, detail }: { system: StarSystem; scale: number; detail: 'system' | 'inspection' }) {
  const star = useRef<THREE.Mesh>(null)
  const radius = system.starRadius * scale

  useFrame((state) => {
    if (star.current && detail === 'system') star.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.7) * 0.025)
  })

  return (
    <group>
      <mesh ref={star}>
        <sphereGeometry args={[radius, detail === 'inspection' ? 64 : 48, detail === 'inspection' ? 64 : 48]} />
        <meshBasicMaterial color={system.starColor} toneMapped={false} fog={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius * 1.42, 40, 40]} />
        <meshBasicMaterial color={system.starColor} transparent opacity={detail === 'inspection' ? 0.12 : 0.14} side={THREE.BackSide} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>
      <pointLight
        color={system.starColor}
        intensity={detail === 'inspection' ? 260 : 132}
        distance={detail === 'inspection' ? radius * 42 : 88}
        decay={detail === 'inspection' ? 1.25 : 1.65}
      />
    </group>
  )
}

export function SystemPrimaryVisual({ system, scale = 1, detail = 'system', animationScale = 1 }: {
  system: StarSystem
  scale?: number
  detail?: 'system' | 'inspection'
  animationScale?: number
}) {
  if (isBlackHoleSystem(system)) return <BlackHoleVisual system={system} scale={scale} detail={detail} animationScale={animationScale} />
  return <StarVisual system={system} scale={scale} detail={detail} />
}

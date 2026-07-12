import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AccretionDiskConfig, StarSystem } from '../domain/universe'

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

function AccretionDisk({ config, scale, detail }: { config: AccretionDiskConfig; scale: number; detail: 'system' | 'inspection' }) {
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
          float spiralA = sin(angle * 13.0 - radial * 36.0 - uTime * 1.5);
          float spiralB = sin(angle * 23.0 + radial * 51.0 + uTime * 0.72);
          float granular = hash(floor(p * 96.0 + uTime * 0.7));
          float filaments = smoothstep(-0.25, 0.82, spiralA * 0.58 + spiralB * 0.28 + granular * 0.34);
          float innerHeat = pow(1.0 - radial, 2.2);
          float edgeFade = smoothstep(0.0, 0.08, radial) * (1.0 - smoothstep(0.9, 1.0, radial));
          vec3 color = mix(uInnerColor, uOuterColor, smoothstep(0.08, 0.92, radial));
          color *= 0.55 + filaments * 0.9 + innerHeat * 1.25;
          float alpha = edgeFade * uOpacity * (0.34 + filaments * 0.66);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    })
  }, [config.innerColor, config.opacity, config.outerColor])

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta * config.rotationSpeed
  })

  const rotation: [number, number, number] = [
    Math.PI / 2 + config.tilt[0],
    config.tilt[1],
    config.tilt[2],
  ]

  return (
    <group rotation={rotation}>
      <mesh material={material} renderOrder={4}>
        <ringGeometry args={[config.innerRadius * scale, config.outerRadius * scale, detail === 'inspection' ? 256 : 160, 1]} />
      </mesh>
      <mesh position={[0, 0, config.thickness * scale * 0.35]} material={material} renderOrder={3}>
        <ringGeometry args={[config.innerRadius * scale * 1.05, config.outerRadius * scale * 0.96, detail === 'inspection' ? 192 : 128, 1]} />
      </mesh>
    </group>
  )
}

function BlackHoleVisual({ system, scale, detail }: { system: StarSystem; scale: number; detail: 'system' | 'inspection' }) {
  const config = system.blackHole
  const horizon = (config?.eventHorizonRadius ?? system.starRadius) * scale
  const ringColor = config?.photonRingColor ?? '#fff0cf'
  const disk = config?.accretionDisk
  const jetLength = (config?.jetLength ?? 0) * scale
  const jetIntensity = config?.jetIntensity ?? 0
  const jetColor = config?.jetColor ?? '#8fd8ff'
  const tilt: [number, number, number] = disk
    ? [Math.PI / 2 + disk.tilt[0], disk.tilt[1], disk.tilt[2]]
    : [Math.PI / 2, 0, 0]

  return (
    <group>
      {disk && <AccretionDisk config={disk} scale={scale} detail={detail} />}

      <mesh renderOrder={8}>
        <sphereGeometry args={[horizon, detail === 'inspection' ? 96 : 64, detail === 'inspection' ? 96 : 64]} />
        <meshBasicMaterial color="#000000" toneMapped={false} fog={false} />
      </mesh>

      <group rotation={tilt}>
        <mesh renderOrder={9}>
          <torusGeometry args={[horizon * 1.22, horizon * 0.07, 20, detail === 'inspection' ? 192 : 128]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.92} toneMapped={false} fog={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh renderOrder={7}>
          <torusGeometry args={[horizon * 1.34, horizon * 0.18, 16, 128]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.16} toneMapped={false} fog={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>

      {disk && (
        <pointLight
          color={disk.innerColor}
          intensity={Math.max(4, disk.luminosity * (detail === 'inspection' ? 42 : 30))}
          distance={disk.outerRadius * scale * 9}
          decay={1.55}
        />
      )}

      {jetLength > 0 && jetIntensity > 0 && (
        <group rotation={tilt}>
          {[1, -1].map((direction) => (
            <mesh key={direction} position={[0, 0, direction * jetLength * 0.5]} rotation={[direction > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0]}>
              <coneGeometry args={[horizon * 0.28, jetLength, 20, 1, true]} />
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
          ))}
        </group>
      )}
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

export function SystemPrimaryVisual({ system, scale = 1, detail = 'system' }: {
  system: StarSystem
  scale?: number
  detail?: 'system' | 'inspection'
}) {
  if (isBlackHoleSystem(system)) return <BlackHoleVisual system={system} scale={scale} detail={detail} />
  return <StarVisual system={system} scale={scale} detail={detail} />
}

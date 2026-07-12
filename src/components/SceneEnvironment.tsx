import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

type SceneMode = 'universe' | 'galaxy' | 'system' | 'planet'

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function starfieldSettings(mode: SceneMode) {
  if (mode === 'galaxy') {
    return {
      radius: 9800,
      count: 9200,
      size: 1.45,
      secondaryCount: 2200,
      secondaryRadius: 6200,
      secondarySize: 1.9,
    }
  }

  if (mode === 'universe') {
    return {
      radius: 2100,
      count: 6500,
      size: 1.35,
      secondaryCount: 1600,
      secondaryRadius: 1320,
      secondarySize: 1.8,
    }
  }

  if (mode === 'planet') {
    return {
      radius: 1050,
      count: 5000,
      size: 1.25,
      secondaryCount: 900,
      secondaryRadius: 620,
      secondarySize: 1.65,
    }
  }

  return {
    radius: 290,
    count: 4200,
    size: 1.2,
    secondaryCount: 800,
    secondaryRadius: 175,
    secondarySize: 1.55,
  }
}

function buildStarGeometry(count: number, radius: number, seed: number, shellWidth: number) {
  const random = seededRandom(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const cool = new THREE.Color('#b8d6ff')
  const neutral = new THREE.Color('#ffffff')
  const warm = new THREE.Color('#ffe1b5')

  for (let index = 0; index < count; index += 1) {
    const y = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const planar = Math.sqrt(Math.max(0, 1 - y * y))
    const distance = radius * (1 - shellWidth + random() * shellWidth)

    positions[index * 3] = Math.cos(angle) * planar * distance
    positions[index * 3 + 1] = y * distance
    positions[index * 3 + 2] = Math.sin(angle) * planar * distance

    const temperature = random()
    const color = temperature < 0.28
      ? cool.clone().lerp(neutral, temperature / 0.28)
      : temperature > 0.83
        ? neutral.clone().lerp(warm, (temperature - 0.83) / 0.17)
        : neutral.clone()
    const brightness = 0.56 + Math.pow(random(), 4) * 0.44
    color.multiplyScalar(brightness)

    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function CameraStarfield({ mode }: { mode: SceneMode }) {
  const root = useRef<THREE.Group>(null)
  const settings = starfieldSettings(mode)
  const primaryGeometry = useMemo(
    () => buildStarGeometry(settings.count, settings.radius, 0x7d31ab + mode.length * 101, 0.3),
    [mode, settings.count, settings.radius],
  )
  const secondaryGeometry = useMemo(
    () => buildStarGeometry(settings.secondaryCount, settings.secondaryRadius, 0xa13f77 + mode.length * 211, 0.22),
    [mode, settings.secondaryCount, settings.secondaryRadius],
  )

  useEffect(() => () => {
    primaryGeometry.dispose()
    secondaryGeometry.dispose()
  }, [primaryGeometry, secondaryGeometry])

  useFrame(({ camera }) => {
    // Distant stars should respond to camera rotation but effectively have no
    // translational parallax. Keeping the shell centered on the camera also
    // prevents the background from disappearing after a long map pan.
    root.current?.position.copy(camera.position)
  })

  return (
    <group ref={root} frustumCulled={false}>
      <points geometry={primaryGeometry} frustumCulled={false} renderOrder={-20}>
        <pointsMaterial
          size={settings.size}
          sizeAttenuation={false}
          vertexColors
          transparent
          opacity={0.82}
          depthWrite={false}
          depthTest
          fog={false}
          toneMapped={false}
        />
      </points>
      <points geometry={secondaryGeometry} frustumCulled={false} renderOrder={-19}>
        <pointsMaterial
          size={settings.secondarySize}
          sizeAttenuation={false}
          vertexColors
          transparent
          opacity={0.42}
          depthWrite={false}
          depthTest
          fog={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

export function SceneEnvironment({ mode }: { mode: SceneMode }) {
  const galaxyMode = mode === 'galaxy'
  const universeMode = mode === 'universe'
  const fogArgs: [string, number, number] = universeMode
    ? ['#03040b', 1200, 2600]
    : galaxyMode
      ? ['#03040b', 6600, 13600]
    : mode === 'system'
      ? ['#03040b', 45, 115]
      : ['#03040b', 420, 1300]

  return (
    <>
      <color attach="background" args={['#03040b']} />
      <fog attach="fog" args={fogArgs} />
      <ambientLight intensity={galaxyMode || universeMode ? 0.15 : 0.26} />
      <CameraStarfield mode={mode} />
    </>
  )
}

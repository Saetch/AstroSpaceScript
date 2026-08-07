import { Line } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { OrbitDefinition } from '../spatial/orbit'
import { sampleOrbit } from '../spatial/orbit'

function PersistentOrbitOverlay({
  points,
  color,
}: {
  points: [number, number, number][]
  color: string
}) {
  const overlay = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points.flatMap((point) => point), 3),
    )

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vec4 clipPosition = projectionMatrix * viewPosition;

          // Keep highlighted orbit vertices inside the far clipping plane while
          // preserving their projected X/Y position. Vertices behind the camera
          // are intentionally left alone so normal camera-facing behavior remains.
          if (clipPosition.w > 0.0) {
            clipPosition.z = min(clipPosition.z, clipPosition.w * 0.999999);
          }

          gl_Position = clipPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;

        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })

    const line = new THREE.Line(geometry, material)
    line.frustumCulled = false
    line.renderOrder = 2000
    return line
  }, [points, color])

  useEffect(
    () => () => {
      overlay.geometry.dispose()
      ;(overlay.material as THREE.Material).dispose()
    },
    [overlay],
  )

  return <primitive object={overlay} />
}

export function OrbitRing({
  orbit,
  renderScale = 1,
  color = '#526083',
  opacity = 0.32,
  lineWidth = 0.7,
  emphasized = false,
}: {
  orbit: OrbitDefinition
  renderScale?: number
  color?: string
  opacity?: number
  lineWidth?: number
  emphasized?: boolean
}) {
  const points = useMemo(
    () => sampleOrbit(orbit, 128, renderScale),
    [orbit, renderScale],
  )

  return (
    <>
      {emphasized && (
        <>
          <Line
            points={points}
            color={color}
            transparent
            opacity={0.22}
            lineWidth={Math.max(7, lineWidth * 4.5)}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
            frustumCulled={false}
            renderOrder={1000}
          />
          <Line
            points={points}
            color={color}
            transparent
            opacity={1}
            lineWidth={Math.max(2.4, lineWidth)}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
            frustumCulled={false}
            renderOrder={1001}
          />
          <PersistentOrbitOverlay points={points} color={color} />
        </>
      )}
      {!emphasized && (
        <Line
          points={points}
          color={color}
          transparent
          opacity={opacity}
          lineWidth={lineWidth}
        />
      )}
    </>
  )
}

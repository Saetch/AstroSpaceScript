import { useFBO } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

const drawingBufferSize = new THREE.Vector2()
const projectedCenter = new THREE.Vector3()
const projectedRight = new THREE.Vector3()
const projectedUp = new THREE.Vector3()
const cameraRight = new THREE.Vector3()
const cameraUp = new THREE.Vector3()
const cameraDirection = new THREE.Vector3()
const lensPosition = new THREE.Vector3()
const viewSpacePosition = new THREE.Vector3()

/**
 * Screen-space black-hole lensing for the system view.
 *
 * We render one capture of the scene behind the black hole, including the
 * accretion disc but excluding objects that are physically in front of the
 * black hole. Both the primary and mirrored secondary lens branches sample
 * from that same capture so the effect stays coherent and we avoid the blue
 * ghost layer caused by compositing a different secondary source.
 */
export function BlackHoleLensingPass({
  active = true,
  worldPosition = [0, 0, 0] as [number, number, number],
  influenceRadius = 10,
  strength = 1,
}: {
  active?: boolean
  worldPosition?: [number, number, number]
  influenceRadius?: number
  strength?: number
}) {
  const { gl, scene, camera } = useThree()
  const lensMesh = useRef<THREE.Mesh>(null)

  const primaryTarget = useFBO({
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
  })

  const material = useMemo(() => new THREE.ShaderMaterial({
    // The lens fully replaces the scene inside its circular footprint. Keeping
    // it opaque and writing depth prevents transparent planets, rings, orbit
    // lines, and other geometry behind the black hole from rendering through
    // the already-lensed image later in the frame.
    transparent: false,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NoBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    uniforms: {
      tPrimary: { value: primaryTarget.texture },
      tSecondary: { value: primaryTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uRadiusUv: { value: new THREE.Vector2(0.1, 0.1) },
      uStrength: { value: strength },
    },
    vertexShader: `
      varying vec2 vLensUv;
      void main() {
        vLensUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vLensUv;
      uniform sampler2D tPrimary;
      uniform sampler2D tSecondary;
      uniform vec2 uResolution;
      uniform vec2 uRadiusUv;
      uniform float uStrength;

      vec3 samplePrimary(vec2 uv) {
        return texture2D(tPrimary, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
      }

      vec3 sampleSecondary(vec2 uv) {
        return texture2D(tSecondary, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
      }

      // The render targets contain linear-sRGB scene color. A custom
      // ShaderMaterial does not automatically append Three.js' output color
      // conversion, so convert once here before writing to the display buffer.
      // Without this, the lensed region appears substantially darker and more
      // blue/saturated than the surrounding scene.
      vec3 linearToDisplaySRGB(vec3 linearColor) {
        vec3 low = linearColor * 12.92;
        vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
        return mix(low, high, step(vec3(0.0031308), linearColor));
      }

      void main() {
        vec2 p = vLensUv;
        float r = length(p);
        if (r > 1.0) discard;

        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec2 dir = r > 0.0001 ? p / r : vec2(1.0, 0.0);

        float theta = max(r, 0.055);
        float einsteinRadius = 0.31 * clamp(uStrength, 0.5, 1.85);
        float sourceRadius = theta - (einsteinRadius * einsteinRadius) / theta;

        // Keep the primary-image branch identical to the good-looking version.
        float primaryValidity = smoothstep(0.0, 0.045, sourceRadius);
        float secondaryValidity = 1.0 - primaryValidity;
        float mappingWeight = 1.0 - smoothstep(0.68, 0.98, r);

        float primaryMappedRadius = mix(r, max(sourceRadius, 0.0), mappingWeight);
        vec2 primaryOffset = dir * primaryMappedRadius;
        vec2 primaryUv = screenUv + vec2(
          (primaryOffset.x - p.x) * uRadiusUv.x,
          (primaryOffset.y - p.y) * uRadiusUv.y
        );

        // Secondary image: same lens equation, but allowed to go negative so
        // it samples from the opposite side. It deliberately uses a capture
        // without the accretion disc to avoid disc duplication.
        float secondaryMappedRadius = mix(r, sourceRadius, mappingWeight);
        vec2 secondaryOffset = dir * secondaryMappedRadius;
        vec2 secondaryUv = screenUv + vec2(
          (secondaryOffset.x - p.x) * uRadiusUv.x,
          (secondaryOffset.y - p.y) * uRadiusUv.y
        );

        vec3 primaryColor = samplePrimary(primaryUv);
        vec3 secondaryColor = sampleSecondary(secondaryUv);
        vec3 finalColor = secondaryColor * secondaryValidity + primaryColor * primaryValidity;

        // The mapping is already the identity near r=1, so an opaque hard
        // boundary is visually seamless: the sampled pixel matches the normal
        // scene at the lens edge. This avoids any alpha-blended ghost layer.
        finalColor = linearToDisplaySRGB(max(finalColor, vec3(0.0)));
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  }), [primaryTarget.texture, strength])

  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    if (!lensMesh.current) return

    const lensedSources: THREE.Object3D[] = []
    const blackHoleForeground: THREE.Object3D[] = []
    const lensingBodies: THREE.Object3D[] = []

    scene.traverse((object) => {
      if (object.userData.blackHoleLensedSource) lensedSources.push(object)
      if (object.userData.blackHoleForeground) blackHoleForeground.push(object)
      if (object.userData.blackHoleLensingBody) lensingBodies.push(object)
    })

    if (!active) {
      lensMesh.current.visible = false
      lensedSources.forEach((object) => { object.visible = true })
      blackHoleForeground.forEach((object) => { object.visible = true })
      return
    }

    const center = lensPosition.set(...worldPosition)
    camera.getWorldDirection(cameraDirection)
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

    lensMesh.current.position.copy(center).addScaledVector(cameraDirection, -influenceRadius * 0.002)
    lensMesh.current.quaternion.copy(camera.quaternion)
    lensMesh.current.scale.setScalar(influenceRadius)
    lensMesh.current.updateMatrixWorld(true)

    projectedCenter.copy(center).project(camera)
    projectedRight.copy(center).addScaledVector(cameraRight, influenceRadius).project(camera)
    projectedUp.copy(center).addScaledVector(cameraUp, influenceRadius).project(camera)

    material.uniforms.uRadiusUv.value.set(
      Math.max(0.001, Math.abs(projectedRight.x - projectedCenter.x) * 0.5),
      Math.max(0.001, Math.abs(projectedUp.y - projectedCenter.y) * 0.5),
    )
    gl.getDrawingBufferSize(drawingBufferSize)
    material.uniforms.uResolution.value.copy(drawingBufferSize)
    material.uniforms.uStrength.value = strength
    material.uniforms.tPrimary.value = primaryTarget.texture
    material.uniforms.tSecondary.value = primaryTarget.texture

    const blackHoleViewZ = viewSpacePosition.copy(center).applyMatrix4(camera.matrixWorldInverse).z
    const bodyVisibility = lensingBodies.map((object) => ({ object, visible: object.visible }))
    const lensedVisibility = lensedSources.map((object) => ({ object, visible: object.visible }))
    const foregroundVisibility = blackHoleForeground.map((object) => ({ object, visible: object.visible }))

    const previousTarget = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    const previousXr = gl.xr.enabled

    gl.autoClear = true
    gl.xr.enabled = false
    lensMesh.current.visible = false

    // Capture 1: full lensed source. Includes the accretion disc once, but not
    // the event horizon or any foreground planet/moon.
    lensedSources.forEach((object) => { object.visible = true })
    blackHoleForeground.forEach((object) => { object.visible = false })
    lensingBodies.forEach((object) => {
      object.getWorldPosition(viewSpacePosition)
      const bodyViewZ = viewSpacePosition.applyMatrix4(camera.matrixWorldInverse).z
      if (bodyViewZ > blackHoleViewZ) object.visible = false
    })

    gl.setRenderTarget(primaryTarget)
    gl.clear()
    gl.render(scene, camera)

    // No separate secondary capture. The mirrored inner lens image samples
    // the same captured scene as the primary branch, which keeps the image
    // coherent and removes the differently tinted/ghosted inner layer.

    gl.setRenderTarget(previousTarget)
    gl.autoClear = previousAutoClear
    gl.xr.enabled = previousXr

    // Final scene: restore ordinary bodies, keep the original disc hidden, and
    // render the sharp foreground black-hole geometry together with the lens.
    bodyVisibility.forEach(({ object, visible }) => { object.visible = visible })
    lensedVisibility.forEach(({ object, visible }) => { object.visible = false && visible })
    foregroundVisibility.forEach(({ object, visible }) => { object.visible = visible })
    lensMesh.current.visible = true
  }, -1)

  return (
    <mesh
      ref={lensMesh}
      material={material}
      renderOrder={6}
      frustumCulled={false}
      raycast={() => null}
    >
      <planeGeometry args={[2, 2, 1, 1]} />
    </mesh>
  )
}

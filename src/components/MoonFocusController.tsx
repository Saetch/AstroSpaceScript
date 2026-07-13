import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export interface MoonFocusTarget {
  id: string
  label: string
  object: THREE.Object3D
  radius: number
}

type OrbitControlsLike = {
  target: THREE.Vector3
  update: () => void
}

type TransitionMode = 'idle' | 'focus' | 'follow' | 'reset'

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

/**
 * Moves the existing camera and OrbitControls target to a moon without
 * remounting the Canvas. Once focused, the camera follows the moon's world
 * translation while the user may still orbit and zoom around it normally.
 */
export function MoonFocusController({
  focus,
  onClear,
  distanceMultiplier,
}: {
  focus?: MoonFocusTarget
  onClear: () => void
  distanceMultiplier: number
}) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | undefined
  const defaultCamera = useRef<THREE.Vector3 | undefined>(undefined)
  const defaultTarget = useRef<THREE.Vector3 | undefined>(undefined)
  const previousWorldPosition = useRef(new THREE.Vector3())
  const transitionStartCamera = useRef(new THREE.Vector3())
  const transitionStartTarget = useRef(new THREE.Vector3())
  const transitionEndCamera = useRef(new THREE.Vector3())
  const transitionEndTarget = useRef(new THREE.Vector3())
  const focusCameraOffset = useRef(new THREE.Vector3())
  const transitionProgress = useRef(0)
  const mode = useRef<TransitionMode>('idle')
  const hadFocus = useRef(false)
  const worldPosition = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (!controls) return
    if (!defaultCamera.current) defaultCamera.current = camera.position.clone()
    if (!defaultTarget.current) defaultTarget.current = controls.target.clone()
  }, [camera, controls])

  useEffect(() => {
    if (!controls || !defaultCamera.current || !defaultTarget.current) return

    transitionStartCamera.current.copy(camera.position)
    transitionStartTarget.current.copy(controls.target)
    transitionProgress.current = 0

    if (focus) {
      focus.object.getWorldPosition(worldPosition)
      transitionEndTarget.current.copy(worldPosition)

      const viewDirection = camera.position.clone().sub(controls.target)
      if (viewDirection.lengthSq() < 0.001) viewDirection.set(1, 0.55, 1)
      viewDirection.normalize()

      const desiredDistance = THREE.MathUtils.clamp(
        Math.max(focus.radius * distanceMultiplier, 1.5),
        1.5,
        14,
      )
      focusCameraOffset.current.copy(viewDirection).multiplyScalar(desiredDistance)
      transitionEndCamera.current.copy(worldPosition).add(focusCameraOffset.current)
      previousWorldPosition.current.copy(worldPosition)
      mode.current = 'focus'
      hadFocus.current = true
      return
    }

    if (hadFocus.current) {
      transitionEndCamera.current.copy(defaultCamera.current)
      transitionEndTarget.current.copy(defaultTarget.current)
      mode.current = 'reset'
      hadFocus.current = false
    }
  }, [camera, controls, distanceMultiplier, focus, worldPosition])

  useFrame((_, delta) => {
    if (!controls) return

    if (mode.current === 'focus' || mode.current === 'reset') {
      if (mode.current === 'focus' && focus) {
        focus.object.getWorldPosition(worldPosition)
        transitionEndTarget.current.copy(worldPosition)
        transitionEndCamera.current.copy(worldPosition).add(focusCameraOffset.current)
        previousWorldPosition.current.copy(worldPosition)
      }
      transitionProgress.current = Math.min(1, transitionProgress.current + delta / 0.62)
      const eased = easeInOutCubic(transitionProgress.current)
      camera.position.lerpVectors(transitionStartCamera.current, transitionEndCamera.current, eased)
      controls.target.lerpVectors(transitionStartTarget.current, transitionEndTarget.current, eased)
      controls.update()

      if (transitionProgress.current >= 1) {
        mode.current = mode.current === 'focus' ? 'follow' : 'idle'
      }
      return
    }

    if (mode.current === 'follow' && focus) {
      focus.object.getWorldPosition(worldPosition)
      const movement = worldPosition.clone().sub(previousWorldPosition.current)
      camera.position.add(movement)
      controls.target.copy(worldPosition)
      previousWorldPosition.current.copy(worldPosition)
      controls.update()
    }
  })

  if (!focus) return null

  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div className="moon-focus-close">
        <button
          type="button"
          aria-label={`Exit moon focus for ${focus.label}`}
          title={`Exit moon focus for ${focus.label}`}
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
          style={{ pointerEvents: 'auto' }}
        >
          ×
        </button>
      </div>
    </Html>
  )
}

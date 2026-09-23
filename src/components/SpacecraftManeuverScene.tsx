import { Html, Line } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  ClientSpacecraftPlan,
  ManeuverAxis,
  ManeuverDeltaV,
  ManeuverPreview,
} from "../spatial/spacecraftManeuver";
import {
  planningOrbitForPlan,
  sampleSpacecraftOrbit,
  spacecraftManeuverBasis,
  spacecraftPhaseAtTime,
  spacecraftPositionAtPhase,
  spacecraftPositionAtTime,
} from "../spatial/spacecraftManeuver";
import { getSimulationTimeSeconds } from "../spatial/simulationClock";
import { SYSTEM_UNITS_TO_WORLD } from "../spatial/renderScales";
import type { Vector3Tuple } from "../domain/universe";

const DRAG_FINE_MPS_PER_PIXEL = 3;
const DRAG_ACCEL_START_PIXELS = 120;

function deltaVFromDragPixels(pixels: number, fine: boolean): number {
  const sign = Math.sign(pixels);
  const distance = Math.abs(pixels);
  const linear =
    Math.min(distance, DRAG_ACCEL_START_PIXELS) * DRAG_FINE_MPS_PER_PIXEL;
  const accelerated = Math.max(0, distance - DRAG_ACCEL_START_PIXELS);
  const delta = linear + accelerated * accelerated * 0.12;
  return sign * delta * (fine ? 0.2 : 1);
}

interface DragState {
  axis: ManeuverAxis;
  sign: 1 | -1;
  startX: number;
  startY: number;
  startValue: number;
  axisWorld: THREE.Vector3;
}

const axisStyle: Record<
  ManeuverAxis,
  { color: string; positive: string; negative: string }
> = {
  prograde: { color: "#6ee9ff", positive: "PRO", negative: "RET" },
  radial: { color: "#ffc96f", positive: "OUT", negative: "IN" },
  normal: { color: "#df8dff", positive: "N+", negative: "N−" },
};

function tupleVector(tuple: Vector3Tuple) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function AxisArrow({
  axis,
  direction,
  sign,
  value,
  onPointerDown,
}: {
  axis: ManeuverAxis;
  direction: Vector3Tuple;
  sign: 1 | -1;
  value: number;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    axis: ManeuverAxis,
    sign: 1 | -1,
    direction: THREE.Vector3,
  ) => void;
}) {
  const directionVector = useMemo(
    () => tupleVector(direction).normalize().multiplyScalar(sign),
    [direction, sign],
  );
  const quaternion = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        directionVector,
      ),
    [directionVector],
  );
  const applied = sign > 0 ? Math.max(0, value) : Math.max(0, -value);
  const extension = THREE.MathUtils.clamp(
    Math.log1p(applied / 300) * 0.55,
    0,
    2.5,
  );
  const length = 1.35 + extension;
  const presentation = axisStyle[axis];

  return (
    <group quaternion={quaternion}>
      <mesh position={[0, length / 2, 0]} renderOrder={1500}>
        <cylinderGeometry args={[0.025, 0.025, length, 8]} />
        <meshBasicMaterial
          color={presentation.color}
          transparent
          opacity={0.72}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[0, length, 0]}
        renderOrder={1502}
        onPointerDown={(event) =>
          onPointerDown(event, axis, sign, directionVector)
        }
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <coneGeometry args={[0.17, 0.44, 12]} />
        <meshBasicMaterial
          color={presentation.color}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <Html
        center
        position={[0, length + 0.38, 0]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className={`maneuver-axis-label maneuver-axis-label--${axis}`}>
          {sign > 0 ? presentation.positive : presentation.negative}
        </div>
      </Html>
    </group>
  );
}

function ManeuverGizmo({
  position,
  basis,
  deltaV,
  valid,
  onDeltaVChange,
}: {
  position: Vector3Tuple;
  basis: { prograde: Vector3Tuple; radial: Vector3Tuple; normal: Vector3Tuple };
  deltaV: ManeuverDeltaV;
  valid: boolean;
  onDeltaVChange: (axis: ManeuverAxis, value: number) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { camera, size, gl } = useThree();
  const controls = (
    useThree() as unknown as { controls?: { enabled: boolean } }
  ).controls;
  const [dragging, setDragging] = useState<DragState>();
  const worldPosition = useMemo(() => tupleVector(position), [position]);
  const onDeltaVChangeRef = useRef(onDeltaVChange);
  const pendingDragValue = useRef<number | undefined>(undefined);
  const dragAnimationFrame = useRef<number | undefined>(undefined);
  onDeltaVChangeRef.current = onDeltaVChange;

  useFrame(() => {
    if (!group.current) return;
    const distance = Math.max(camera.position.distanceTo(worldPosition), 0.001);
    const perspective = camera as THREE.PerspectiveCamera;
    const pixelsPerWorldUnit = perspective.isPerspectiveCamera
      ? size.height /
        (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) * distance)
      : 1;
    const scale = THREE.MathUtils.clamp(
      58 / Math.max(pixelsPerWorldUnit, 0.00001) / 1.35,
      0.55,
      12_000,
    );
    group.current.scale.setScalar(scale);
  });

  useEffect(() => {
    if (!dragging) return;

    if (controls) controls.enabled = false;
    const previousCursor = gl.domElement.style.cursor;
    const previousTouchAction = gl.domElement.style.touchAction;
    gl.domElement.style.cursor = "grabbing";
    gl.domElement.style.touchAction = "none";

    const projectedDirection = () => {
      const start = worldPosition.clone().project(camera);
      const end = worldPosition.clone().add(dragging.axisWorld).project(camera);
      const screen = new THREE.Vector2(
        (end.x - start.x) * size.width * 0.5,
        -(end.y - start.y) * size.height * 0.5,
      );
      return screen.lengthSq() > 0.00001
        ? screen.normalize()
        : new THREE.Vector2(1, 0);
    };

    const handleMove = (event: PointerEvent) => {
      event.preventDefault();
      const screenAxis = projectedDirection();
      const dx = event.clientX - dragging.startX;
      const dy = event.clientY - dragging.startY;
      const outwardPixels = dx * screenAxis.x + dy * screenAxis.y;
      const next =
        dragging.startValue +
        deltaVFromDragPixels(outwardPixels, event.shiftKey) * dragging.sign;
      if (!Number.isFinite(next)) return;

      // Pointer events can arrive much faster than React/Three can redraw. Collapse
      // them to one state update per animation frame; the final pointer-up value is
      // flushed synchronously below.
      pendingDragValue.current = next;
      if (dragAnimationFrame.current === undefined) {
        dragAnimationFrame.current = window.requestAnimationFrame(() => {
          dragAnimationFrame.current = undefined;
          const pending = pendingDragValue.current;
          pendingDragValue.current = undefined;
          if (pending !== undefined) {
            onDeltaVChangeRef.current(dragging.axis, pending);
          }
        });
      }
    };

    const finish = () => {
      if (dragAnimationFrame.current !== undefined) {
        window.cancelAnimationFrame(dragAnimationFrame.current);
        dragAnimationFrame.current = undefined;
      }
      const pending = pendingDragValue.current;
      pendingDragValue.current = undefined;
      if (pending !== undefined) {
        onDeltaVChangeRef.current(dragging.axis, pending);
      }
      setDragging(undefined);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (dragAnimationFrame.current !== undefined) {
        window.cancelAnimationFrame(dragAnimationFrame.current);
        dragAnimationFrame.current = undefined;
      }
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = previousCursor;
      gl.domElement.style.touchAction = previousTouchAction;
      document.body.style.cursor = "";
    };
  }, [
    camera,
    controls,
    dragging,
    gl.domElement.style,
    size.height,
    size.width,
    worldPosition,
  ]);

  const beginDrag = (
    event: ThreeEvent<PointerEvent>,
    axis: ManeuverAxis,
    sign: 1 | -1,
    axisWorld: THREE.Vector3,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    setDragging({
      axis,
      sign,
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      startValue: deltaV[axis],
      axisWorld: axisWorld.clone(),
    });
  };

  return (
    <group ref={group} position={position}>
      <mesh renderOrder={1498}>
        <sphereGeometry args={[0.18, 18, 18]} />
        <meshBasicMaterial
          color={valid ? "#fff1b0" : "#ff718b"}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1497}>
        <ringGeometry args={[0.28, 0.34, 36]} />
        <meshBasicMaterial
          color={valid ? "#ffd685" : "#ff718b"}
          transparent
          opacity={0.9}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {(["prograde", "radial", "normal"] as ManeuverAxis[]).flatMap((axis) =>
        ([1, -1] as const).map((sign) => (
          <AxisArrow
            key={`${axis}:${sign}`}
            axis={axis}
            direction={basis[axis]}
            sign={sign}
            value={deltaV[axis]}
            onPointerDown={beginDrag}
          />
        )),
      )}
    </group>
  );
}

export function SpacecraftManeuverScene({
  plan,
  preview,
  gravitationalParameter,
  renderScale = SYSTEM_UNITS_TO_WORLD,
  originPositionAtTime,
  onDeltaVChange,
}: {
  plan: ClientSpacecraftPlan;
  preview: ManeuverPreview;
  gravitationalParameter: number;
  renderScale?: number;
  originPositionAtTime?: (simulationTimeSeconds: number) => Vector3Tuple;
  onDeltaVChange: (axis: ManeuverAxis, value: number) => void;
}) {
  const origin = useRef<THREE.Group>(null);
  const ship = useRef<THREE.Group>(null);
  const shipVisual = useRef<THREE.Group>(null);
  const shipHitScale = useRef<THREE.Group>(null);
  const planningOrbit = useMemo(() => planningOrbitForPlan(plan), [plan]);
  const currentPoints = useMemo(
    () => sampleSpacecraftOrbit(plan.orbit, 180, renderScale),
    [plan.orbit, renderScale],
  );
  const queuedOrbitPoints = useMemo(
    () =>
      (plan.maneuverQueue ?? []).map((node) => ({
        id: node.id,
        points: sampleSpacecraftOrbit(node.orbitAfter, 180, renderScale),
      })),
    [plan.maneuverQueue, renderScale],
  );
  const previewPoints = useMemo(
    () => sampleSpacecraftOrbit(preview.orbit, 180, renderScale),
    [preview.orbit, renderScale],
  );
  const burnPosition = useMemo(
    () =>
      spacecraftPositionAtPhase(
        planningOrbit,
        plan.maneuver.burnPhase,
        renderScale,
      ),
    [planningOrbit, plan.maneuver.burnPhase, renderScale],
  );
  const maneuverBasis = useMemo(
    () =>
      spacecraftManeuverBasis(
        planningOrbit,
        plan.maneuver.burnPhase,
        gravitationalParameter,
      ),
    [planningOrbit, plan.maneuver.burnPhase, gravitationalParameter],
  );

  useFrame(({ camera, size }) => {
    const simulationTime = getSimulationTimeSeconds();
    const lookAheadSeconds = 0.045;
    const originNow = originPositionAtTime?.(simulationTime) ?? [0, 0, 0];
    const originAhead =
      originPositionAtTime?.(simulationTime + lookAheadSeconds) ?? originNow;
    if (origin.current && originPositionAtTime) {
      origin.current.position.set(...originNow);
    }
    if (!ship.current) return;
    const position = spacecraftPositionAtTime(
      plan.orbit,
      simulationTime,
      renderScale,
    );
    ship.current.position.set(...position);

    if (shipVisual.current) {
      const ahead = spacecraftPositionAtTime(
        plan.orbit,
        simulationTime + lookAheadSeconds,
        renderScale,
      );
      const direction = new THREE.Vector3(
        originAhead[0] + ahead[0] - originNow[0] - position[0],
        originAhead[1] + ahead[1] - originNow[1] - position[1],
        originAhead[2] + ahead[2] - originNow[2] - position[2],
      );
      if (direction.lengthSq() > 1e-10) {
        const forward = direction.normalize();
        const phase = spacecraftPhaseAtTime(plan.orbit, simulationTime);
        const normalTuple = spacecraftManeuverBasis(
          plan.orbit,
          phase,
          gravitationalParameter,
        ).normal;
        const desiredUp = new THREE.Vector3(...normalTuple).normalize();
        let side = new THREE.Vector3().crossVectors(forward, desiredUp);
        if (side.lengthSq() < 1e-8) side = new THREE.Vector3(0, 0, 1);
        side.normalize();
        const correctedUp = new THREE.Vector3()
          .crossVectors(side, forward)
          .normalize();
        const attitude = new THREE.Matrix4().makeBasis(
          forward,
          correctedUp,
          side,
        );
        const target = new THREE.Quaternion().setFromRotationMatrix(attitude);
        shipVisual.current.quaternion.slerp(target, 0.16);
      }
    }

    const worldPosition = new THREE.Vector3();
    ship.current.getWorldPosition(worldPosition);
    const distance = camera.position.distanceTo(worldPosition);
    const perspective = camera as THREE.PerspectiveCamera;
    const pixelsPerWorldUnit = perspective.isPerspectiveCamera
      ? size.height /
        (2 *
          Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) *
          Math.max(distance, 0.001))
      : 1;
    const visualScale = THREE.MathUtils.clamp(
      8 / Math.max(pixelsPerWorldUnit, 0.001),
      0.45,
      30,
    );
    shipHitScale.current?.scale.setScalar(visualScale);
  });

  if (plan.flightState !== "orbiting") return null;

  return (
    <group ref={origin}>
      <Line
        points={currentPoints}
        color="#7be8ff"
        transparent
        opacity={0.72}
        lineWidth={1.2}
        depthWrite={false}
      />

      {queuedOrbitPoints.map((queued, index) => (
        <Line
          key={queued.id}
          points={queued.points}
          color="#8ab8ff"
          transparent
          opacity={Math.max(0.18, 0.48 - index * 0.06)}
          lineWidth={1.35}
          depthTest={false}
          depthWrite={false}
          renderOrder={1180 + index}
        />
      ))}

      {(plan.maneuverQueue ?? []).map((node, index) => {
        const nodePosition = spacecraftPositionAtPhase(
          node.orbitBefore,
          node.burnPhase,
          renderScale,
        );
        return (
          <group
            key={node.id}
            position={nodePosition}
            renderOrder={1450 + index}
          >
            <mesh frustumCulled={false}>
              <sphereGeometry args={[0.09, 14, 14]} />
              <meshBasicMaterial
                color="#8fb9ff"
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <Html
              center
              position={[0, 0.42, 0]}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              <div className="maneuver-node-label maneuver-node-label--scheduled">
                <strong>NODE {index + 1}</strong>
                <span>Δv {Math.round(node.deltaVMagnitude)} m/s</span>
              </div>
            </Html>
          </group>
        );
      })}

      {preview.deltaVMagnitude > 0.01 && preview.valid && (
        <>
          <Line
            points={previewPoints}
            color="#ffd685"
            transparent
            opacity={0.2}
            lineWidth={6}
            depthTest={false}
            depthWrite={false}
            renderOrder={1200}
          />
          <Line
            points={previewPoints}
            color="#fff0b4"
            transparent
            opacity={0.95}
            lineWidth={2}
            depthTest={false}
            depthWrite={false}
            renderOrder={1201}
          />
        </>
      )}

      <ManeuverGizmo
        position={burnPosition}
        basis={maneuverBasis}
        deltaV={plan.maneuver.deltaV}
        valid={preview.valid}
        onDeltaVChange={onDeltaVChange}
      />

      <Html
        center
        position={[burnPosition[0], burnPosition[1] + 1.1, burnPosition[2]]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className="maneuver-node-label">
          <strong>NEXT DRAFT</strong>
          <span>Δv {Math.round(preview.deltaVMagnitude)} m/s</span>
        </div>
      </Html>

      <group ref={ship}>
        <group ref={shipVisual}>
          <group ref={shipHitScale}>
            <mesh rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.28, 0.9, 5]} />
              <meshStandardMaterial
                color="#dff8ff"
                emissive="#57d8ff"
                emissiveIntensity={1.3}
                roughness={0.32}
                metalness={0.72}
              />
            </mesh>
            <mesh position={[-0.52, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[0.12, 0.42, 10]} />
              <meshBasicMaterial
                color="#69e9ff"
                transparent
                opacity={0.78}
                toneMapped={false}
              />
            </mesh>
            <pointLight color="#63ddff" intensity={1.4} distance={5} />
          </group>
        </group>
        <Html
          center
          position={[0, 0.75, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div className="spacecraft-label">
            <strong>{plan.name}</strong>
            <span>{plan.primaryBodyName.toUpperCase()} FRAME</span>
          </div>
        </Html>
      </group>
    </group>
  );
}

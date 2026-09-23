import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { StarSystem, Vector3Tuple } from "../domain/universe";
import { bodySystemPositionAtTime } from "../spatial/flightInfluence";
import {
  sampleSpacecraftOrbit,
  type InfluencePrediction,
  type TransferTargetPrediction,
} from "../spatial/spacecraftManeuver";
import { getSimulationTimeSeconds } from "../spatial/simulationClock";

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vector3Tuple, factor: number): Vector3Tuple {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function formatEta(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function relativeSystemPoint(
  system: StarSystem,
  point: Vector3Tuple,
  simulationTimeSeconds: number,
  referenceBodyId?: string,
): Vector3Tuple {
  if (!referenceBodyId) return point;
  return subtract(
    point,
    bodySystemPositionAtTime(system, referenceBodyId, simulationTimeSeconds),
  );
}

export function TransferPredictionScene({
  system,
  prediction,
  targetApproach,
  renderScale,
  referenceBodyId,
}: {
  system: StarSystem;
  prediction?: InfluencePrediction;
  targetApproach?: TransferTargetPrediction;
  renderScale: number;
  referenceBodyId?: string;
}) {
  const now = getSimulationTimeSeconds();
  const eventGeometry = useMemo(() => {
    if (!prediction) return undefined;
    const event = scale(
      relativeSystemPoint(
        system,
        prediction.atSystemPosition,
        prediction.atSimulationTime,
        referenceBodyId,
      ),
      renderScale,
    );
    const boundaryCenter = scale(
      relativeSystemPoint(
        system,
        prediction.boundaryCenterSystemPosition,
        prediction.atSimulationTime,
        referenceBodyId,
      ),
      renderScale,
    );
    const destinationCenterSystem = bodySystemPositionAtTime(
      system,
      prediction.toBodyId,
      prediction.atSimulationTime,
    );
    const destinationCenter = scale(
      relativeSystemPoint(
        system,
        destinationCenterSystem,
        prediction.atSimulationTime,
        referenceBodyId,
      ),
      renderScale,
    );
    const destinationOrbit = sampleSpacecraftOrbit(
      prediction.destinationOrbit,
      180,
      renderScale,
    ).map((point) => add(point, destinationCenter));

    return { event, boundaryCenter, destinationOrbit };
  }, [prediction, referenceBodyId, renderScale, system]);

  const missGeometry = useMemo(() => {
    if (!targetApproach || targetApproach.willTransition) return undefined;
    const ship = scale(
      relativeSystemPoint(
        system,
        targetApproach.spacecraftSystemPosition,
        targetApproach.atSimulationTime,
        referenceBodyId,
      ),
      renderScale,
    );
    const center = scale(
      relativeSystemPoint(
        system,
        targetApproach.boundaryCenterSystemPosition,
        targetApproach.atSimulationTime,
        referenceBodyId,
      ),
      renderScale,
    );
    return { ship, center };
  }, [referenceBodyId, renderScale, system, targetApproach]);

  return (
    <group>
      {prediction && eventGeometry && (
        <>
          <mesh
            position={eventGeometry.boundaryCenter}
            renderOrder={1240}
            frustumCulled={false}
          >
            <sphereGeometry
              args={[prediction.boundaryRadius * renderScale, 32, 18]}
            />
            <meshBasicMaterial
              color="#69f2c2"
              wireframe
              transparent
              opacity={0.13}
              toneMapped={false}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={eventGeometry.destinationOrbit}
            color="#79ffd2"
            transparent
            opacity={0.18}
            lineWidth={7}
            depthTest={false}
            depthWrite={false}
            renderOrder={1241}
          />
          <Line
            points={eventGeometry.destinationOrbit}
            color="#c7ffe9"
            transparent
            opacity={0.82}
            lineWidth={1.5}
            depthTest={false}
            depthWrite={false}
            renderOrder={1242}
          />
          <group position={eventGeometry.event} renderOrder={1244}>
            <mesh rotation={[Math.PI / 2, 0, 0]} frustumCulled={false}>
              <ringGeometry args={[0.18, 0.27, 28]} />
              <meshBasicMaterial
                color="#d8ffed"
                side={THREE.DoubleSide}
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <mesh frustumCulled={false}>
              <sphereGeometry args={[0.08, 14, 14]} />
              <meshBasicMaterial
                color="#65ffc4"
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <Html
              center
              position={[0, 0.55, 0]}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              <div className="transfer-event-label">
                <strong>
                  {prediction.eventKind === "entry" ? "SOI ENTRY" : "SOI EXIT"}{" "}
                  · {prediction.toBodyName}
                </strong>
                <span>
                  {formatEta(Math.max(0, prediction.atSimulationTime - now))} ·{" "}
                  {prediction.orbitsFromNow.toFixed(1)} orbits
                </span>
              </div>
            </Html>
          </group>
        </>
      )}

      {targetApproach && missGeometry && (
        <>
          <Line
            points={[missGeometry.center, missGeometry.ship]}
            color="#ffb978"
            transparent
            opacity={0.6}
            lineWidth={1.2}
            dashed
            dashScale={2.2}
            dashSize={0.45}
            gapSize={0.3}
            depthTest={false}
            depthWrite={false}
            renderOrder={1235}
          />
          <group position={missGeometry.ship} renderOrder={1236}>
            <mesh frustumCulled={false}>
              <sphereGeometry args={[0.075, 12, 12]} />
              <meshBasicMaterial
                color="#ffbd7d"
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <Html
              center
              position={[0, 0.48, 0]}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              <div className="transfer-event-label transfer-event-label--miss">
                <strong>CLOSEST · {targetApproach.targetBodyName}</strong>
                <span>
                  miss by {targetApproach.boundaryGap.toFixed(2)} u ·{" "}
                  {formatEta(Math.max(0, targetApproach.atSimulationTime - now))} ·{" "}
                  {targetApproach.orbitsFromNow.toFixed(1)} orbits
                </span>
              </div>
            </Html>
          </group>
        </>
      )}
    </group>
  );
}

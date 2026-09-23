import { Billboard, Html } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { StarSystem, Vector3Tuple } from "../domain/universe";
import { bodySystemPositionAtTime } from "../spatial/flightInfluence";

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vector3Tuple, factor: number): Vector3Tuple {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function formatFutureOffset(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function FutureBodyGhostScene({
  system,
  atSimulationTime,
  nowSimulationTime,
  renderScale,
  referenceBodyId,
}: {
  system: StarSystem;
  atSimulationTime?: number;
  nowSimulationTime: number;
  renderScale: number;
  referenceBodyId?: string;
}) {
  const ghosts = useMemo(() => {
    if (atSimulationTime === undefined) return [];
    const reference = referenceBodyId
      ? bodySystemPositionAtTime(system, referenceBodyId, atSimulationTime)
      : ([0, 0, 0] as Vector3Tuple);

    return system.planets.flatMap((planet) => {
      const entries: Array<{
        id: string;
        name: string;
        kind: "planet" | "moon";
        radius: number;
        position: Vector3Tuple;
      }> = [];

      if (planet.id !== referenceBodyId) {
        entries.push({
          id: planet.id,
          name: planet.name,
          kind: "planet",
          radius: planet.radius,
          position: scale(
            subtract(
              bodySystemPositionAtTime(system, planet.id, atSimulationTime),
              reference,
            ),
            renderScale,
          ),
        });
      }

      for (const moon of planet.moons ?? []) {
        if (moon.id === referenceBodyId) continue;
        entries.push({
          id: moon.id,
          name: moon.name,
          kind: "moon",
          radius: moon.radius,
          position: scale(
            subtract(
              bodySystemPositionAtTime(system, moon.id, atSimulationTime),
              reference,
            ),
            renderScale,
          ),
        });
      }
      return entries;
    });
  }, [atSimulationTime, referenceBodyId, renderScale, system]);

  if (atSimulationTime === undefined) return null;
  const eta = Math.max(0, atSimulationTime - nowSimulationTime);

  return (
    <group renderOrder={1215}>
      {ghosts.map((ghost) => {
        const size = THREE.MathUtils.clamp(
          ghost.kind === "planet" ? ghost.radius * 0.14 : ghost.radius * 0.24,
          ghost.kind === "planet" ? 0.22 : 0.12,
          ghost.kind === "planet" ? 0.75 : 0.38,
        );
        return (
          <group key={ghost.id} position={ghost.position} frustumCulled={false}>
            <Billboard follow>
              <mesh renderOrder={1215}>
                <ringGeometry args={[size * 0.62, size, 30]} />
                <meshBasicMaterial
                  color={ghost.kind === "planet" ? "#7eeeff" : "#d5c9ff"}
                  transparent
                  opacity={0.48}
                  toneMapped={false}
                  depthTest={false}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh renderOrder={1214}>
                <circleGeometry args={[size * 0.18, 20]} />
                <meshBasicMaterial
                  color={ghost.kind === "planet" ? "#a8f6ff" : "#e4dcff"}
                  transparent
                  opacity={0.42}
                  toneMapped={false}
                  depthTest={false}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </Billboard>
            <Html
              center
              position={[0, size + 0.18, 0]}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              <div className="future-body-ghost-label">
                <strong>{ghost.name}</strong>
                <span>at node · +{formatFutureOffset(eta)}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

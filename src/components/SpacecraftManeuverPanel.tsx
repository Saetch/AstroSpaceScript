import { useEffect, useState } from "react";
import type { FlightBody } from "../spatial/flightInfluence";
import { getSimulationTimeSeconds } from "../spatial/simulationClock";
import type {
  ClientSpacecraftPlan,
  InfluencePrediction,
  ManeuverAxis,
  TransferTargetPrediction,
  ManeuverPreview,
} from "../spatial/spacecraftManeuver";
import {
  draftManeuverExecutionTime,
  formatFlightBodyKind,
  spacecraftInclinationDegrees,
} from "../spatial/spacecraftManeuver";

function signed(value: number) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function formatEta(seconds: number) {
  if (seconds < 1) return "<1s";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const axisPresentation: Array<{
  axis: ManeuverAxis;
  title: string;
  negative: string;
  positive: string;
}> = [
  {
    axis: "prograde",
    title: "Tangential Δv",
    negative: "Retrograde",
    positive: "Prograde",
  },
  {
    axis: "radial",
    title: "Radial Δv",
    negative: "Radial in",
    positive: "Radial out",
  },
  {
    axis: "normal",
    title: "Plane Δv",
    negative: "Anti-normal",
    positive: "Normal",
  },
];

function DeltaVAxisControl({
  axis,
  title,
  negative,
  positive,
  value,
  onChange,
}: {
  axis: ManeuverAxis;
  title: string;
  negative: string;
  positive: string;
  value: number;
  onChange: (axis: ManeuverAxis, value: number) => void;
}) {
  const setValue = (next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(axis, next);
  };
  // Native range controls need finite bounds, but changing those bounds while the
  // thumb is moving makes the control feel like it is slipping underneath the mouse.
  // Lock the presentation range for the duration of a drag, then resize afterwards.
  // This is only a UI viewport: numeric entry and the 3D gizmo remain unbounded.
  const requiredRange = Math.max(
    2500,
    Math.ceil((Math.abs(value) * 1.35 + 500) / 500) * 500,
  );
  const [rangeLimit, setRangeLimit] = useState(requiredRange);
  const [sliding, setSliding] = useState(false);
  useEffect(() => {
    if (!sliding) setRangeLimit(requiredRange);
  }, [requiredRange, sliding]);

  return (
    <div className={`maneuver-field maneuver-field--${axis}`}>
      <span>
        <span>{title}</span>
        <b>{signed(value)} m/s</b>
      </span>
      <div className="maneuver-axis-endpoints" aria-hidden="true">
        <small>← {negative}</small>
        <small>{positive} →</small>
      </div>
      <input
        type="range"
        min={-rangeLimit}
        max={rangeLimit}
        step="1"
        value={Math.max(-rangeLimit, Math.min(rangeLimit, value))}
        onPointerDown={() => {
          setRangeLimit(requiredRange);
          setSliding(true);
        }}
        onPointerUp={() => setSliding(false)}
        onPointerCancel={() => setSliding(false)}
        onChange={(event) => setValue(Number(event.target.value))}
        aria-label={`${negative} to ${positive} delta-v`}
      />
      <div className="maneuver-precision-row">
        <button type="button" onClick={() => setValue(value - 100)}>
          −100
        </button>
        <button type="button" onClick={() => setValue(value - 10)}>
          −10
        </button>
        <input
          type="number"
          step="1"
          value={Math.round(value)}
          onChange={(event) => setValue(Number(event.target.value) || 0)}
          aria-label={`Exact ${axis} delta-v in meters per second`}
        />
        <button type="button" onClick={() => setValue(value + 10)}>
          +10
        </button>
        <button type="button" onClick={() => setValue(value + 100)}>
          +100
        </button>
      </div>
    </div>
  );
}

export function SpacecraftManeuverPanel({
  plan,
  preview,
  primaryBody,
  influencePrediction,
  targetBodies,
  targetApproach,
  onTargetChange,
  onBurnPhaseChange,
  onOrbitPassChange,
  onDeltaVChange,
  onSchedule,
  onRemovePlannedNode,
  onClearPlannedNodes,
  onReset,
  onRemove,
}: {
  plan: ClientSpacecraftPlan;
  preview: ManeuverPreview;
  primaryBody: FlightBody;
  influencePrediction?: InfluencePrediction;
  targetBodies: FlightBody[];
  targetApproach?: TransferTargetPrediction;
  onTargetChange: (bodyId: string | undefined) => void;
  onBurnPhaseChange: (phase: number) => void;
  onOrbitPassChange: (orbitPass: number) => void;
  onDeltaVChange: (axis: ManeuverAxis, deltaV: number) => void;
  onSchedule: () => void;
  onRemovePlannedNode: (nodeId: string) => void;
  onClearPlannedNodes: () => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const [now, setNow] = useState(() => getSimulationTimeSeconds());
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(getSimulationTimeSeconds()),
      250,
    );
    return () => window.clearInterval(timer);
  }, []);

  const queue = plan.maneuverQueue ?? [];
  const nextNode = queue[0];
  const burnPercent = Math.round(
    (plan.maneuver.burnPhase / (Math.PI * 2)) * 100,
  );
  const previewOrbit = preview.valid ? preview.orbit : plan.orbit;
  const draftExecutionTime = draftManeuverExecutionTime(plan, now);
  const draftEta = Math.max(0, draftExecutionTime - now);
  const nextNodeEta = nextNode
    ? Math.max(0, nextNode.executeAtSimulationTime - now)
    : undefined;
  const approachEta = targetApproach
    ? Math.max(0, targetApproach.atSimulationTime - now)
    : undefined;
  const influenceEta = influencePrediction
    ? Math.max(0, influencePrediction.atSimulationTime - now)
    : undefined;

  return (
    <section
      className="maneuver-planner glass-panel"
      aria-label="Spacecraft maneuver planner"
    >
      <div className="maneuver-planner__heading">
        <span>
          <small>
            {formatFlightBodyKind(primaryBody.kind).toUpperCase()} FLIGHT
          </small>
          <strong>{plan.name}</strong>
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove local spacecraft"
        >
          ×
        </button>
      </div>

      <div className="maneuver-planner__status">
        <span>
          {queue.length > 0
            ? `${queue.length} NODE${queue.length === 1 ? "" : "S"} PLANNED`
            : "PLANNING MODE"}
        </span>
        <small>
          Primary: {primaryBody.name} · influence{" "}
          {primaryBody.influenceRadius.toFixed(2)} u
          {nextNodeEta !== undefined
            ? ` · next burn in ${formatEta(nextNodeEta)}`
            : ""}
        </small>
      </div>

      {queue.length > 0 && (
        <div className="maneuver-queue">
          <div className="maneuver-queue__heading">
            <span>FLIGHT PLAN</span>
            <button type="button" onClick={onClearPlannedNodes}>
              Clear all
            </button>
          </div>
          {queue.map((node, index) => (
            <div key={node.id} className="maneuver-queue__node">
              <span>
                <b>NODE {index + 1}</b>
                <small>
                  {formatEta(Math.max(0, node.executeAtSimulationTime - now))} ·
                  pass {node.orbitPass + 1}
                </small>
              </span>
              <span>
                <strong>{Math.round(node.deltaVMagnitude)} m/s</strong>
                <button
                  type="button"
                  onClick={() => onRemovePlannedNode(node.id)}
                  title="Remove this node and every node planned after it"
                >
                  Remove →
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="maneuver-transfer-target">
        <label>
          <span>NEXT FRAME TARGET</span>
          <select
            value={plan.transferTargetBodyId ?? ""}
            onChange={(event) =>
              onTargetChange(event.target.value || undefined)
            }
          >
            <option value="">No target</option>
            {targetBodies.map((body) => (
              <option key={body.id} value={body.id}>
                {body.name} · {formatFlightBodyKind(body.kind)}
              </option>
            ))}
          </select>
        </label>
        <p>
          Forecasts include every queued node plus the draft node below. Closest
          approach is continuously refined rather than chosen from a moving
          sample point.
        </p>
        {targetApproach ? (
          <div
            className={`maneuver-transfer-result ${targetApproach.willTransition && !targetApproach.blockedByBodyName ? "maneuver-transfer-result--hit" : ""}`}
          >
            <strong>
              {targetApproach.blockedByBodyName
                ? "FRAME CHANGE FIRST"
                : targetApproach.willTransition
                  ? "SOI INTERCEPT"
                  : "CLOSEST APPROACH"}
            </strong>
            <span>
              {targetApproach.targetBodyName} · {formatEta(approachEta ?? 0)} ·{" "}
              {targetApproach.orbitsFromNow.toFixed(1)} orbits
            </span>
            <small>
              {targetApproach.blockedByBodyName
                ? `${targetApproach.blockedByBodyName} is reached first. Replan after that SOI handoff.`
                : targetApproach.willTransition
                  ? `Boundary crossed at ${targetApproach.boundaryRadius.toFixed(2)} u.`
                  : `${targetApproach.boundaryGap.toFixed(3)} u short of the influence boundary.`}
            </small>
          </div>
        ) : plan.transferTargetBodyId ? (
          <div className="maneuver-transfer-result">
            <strong>NO SOLUTION IN SEARCH</strong>
            <span>Try another node time, pass, or Δv.</span>
          </div>
        ) : null}
      </div>

      <label className="maneuver-field">
        <span>
          Burn position <b>{burnPercent}%</b>
        </span>
        <input
          type="range"
          min="0"
          max={Math.PI * 2}
          step="0.01"
          value={plan.maneuver.burnPhase}
          onChange={(event) => onBurnPhaseChange(Number(event.target.value))}
        />
      </label>

      <div className="maneuver-pass-control">
        <label>
          <span>
            Orbit crossing{" "}
            <b>
              {plan.maneuver.orbitPass === 0
                ? "next"
                : `+${plan.maneuver.orbitPass} rev`}
            </b>
          </span>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={Math.min(20, plan.maneuver.orbitPass ?? 0)}
            onChange={(event) => onOrbitPassChange(Number(event.target.value))}
          />
        </label>
        <label className="maneuver-pass-control__exact">
          <span>Extra revolutions</span>
          <input
            type="number"
            min="0"
            max="999"
            step="1"
            value={plan.maneuver.orbitPass ?? 0}
            onChange={(event) =>
              onOrbitPassChange(Number(event.target.value) || 0)
            }
          />
        </label>
        <small>
          Draft executes in {formatEta(draftEta)}. Move this or the burn
          position to watch the future-body shadows move to that exact time.
        </small>
      </div>

      <div className="maneuver-axis-help">
        Drag any of the six arrows on the 3D node, or use the precise controls
        below. Adding a node freezes that burn in the queue and starts the next
        draft on its predicted orbit.
      </div>

      {axisPresentation.map((item) => (
        <DeltaVAxisControl
          key={item.axis}
          {...item}
          value={plan.maneuver.deltaV[item.axis]}
          onChange={onDeltaVChange}
        />
      ))}

      <dl className="maneuver-telemetry">
        <div>
          <dt>Draft Δv</dt>
          <dd>{Math.round(preview.deltaVMagnitude)} m/s</dd>
        </div>
        <div>
          <dt>Semi-major</dt>
          <dd>{previewOrbit.semiMajorAxis.toFixed(2)} u</dd>
        </div>
        <div>
          <dt>Eccentricity</dt>
          <dd>{previewOrbit.eccentricity.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Inclination</dt>
          <dd>{spacecraftInclinationDegrees(previewOrbit).toFixed(2)}°</dd>
        </div>
      </dl>

      <div className="maneuver-influence-forecast">
        <span>NEXT INFLUENCE EVENT</span>
        {influencePrediction ? (
          <strong>
            {influencePrediction.fromBodyName} →{" "}
            {influencePrediction.toBodyName}
            <small>
              {" "}
              in {formatEta(influenceEta ?? 0)} ·{" "}
              {influencePrediction.orbitsFromNow.toFixed(1)} orbits
            </small>
          </strong>
        ) : (
          <strong>No boundary crossing in the next 1000 orbits</strong>
        )}
      </div>

      {plan.lastInfluenceTransition && (
        <p className="maneuver-planner__note">
          Last handoff: {plan.lastInfluenceTransition.fromBodyName} →{" "}
          {plan.lastInfluenceTransition.toBodyName}. Nodes still tied to the old
          frame were cleared.
        </p>
      )}
      {preview.warning && <p className="maneuver-warning">{preview.warning}</p>}

      <div className="maneuver-planner__actions">
        <button
          type="button"
          className="maneuver-secondary"
          onClick={onReset}
          disabled={preview.deltaVMagnitude < 0.01}
        >
          Reset draft
        </button>
        <button
          type="button"
          className="maneuver-primary"
          onClick={onSchedule}
          disabled={!preview.valid || preview.deltaVMagnitude < 0.01}
        >
          Add planned node
        </button>
      </div>
      <p className="maneuver-planner__note">
        Runtime movement executes queued nodes at their absolute simulation
        timestamps. The live ship never adopts a future orbit early; each orbit
        change happens only when its node is reached.
      </p>
    </section>
  );
}

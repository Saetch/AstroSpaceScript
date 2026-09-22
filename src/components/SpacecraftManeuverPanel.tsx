import type { ClientSpacecraftPlan, ManeuverAxis, ManeuverPreview } from '../spatial/spacecraftManeuver'
import { spacecraftInclinationDegrees } from '../spatial/spacecraftManeuver'

function signed(value: number) {
  const rounded = Math.round(value)
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

const axisPresentation: Array<{
  axis: ManeuverAxis
  title: string
  negative: string
  positive: string
}> = [
  { axis: 'prograde', title: 'Tangential Δv', negative: 'Retrograde', positive: 'Prograde' },
  { axis: 'radial', title: 'Radial Δv', negative: 'Radial in', positive: 'Radial out' },
  { axis: 'normal', title: 'Plane Δv', negative: 'Anti-normal', positive: 'Normal' },
]

function DeltaVAxisControl({
  axis,
  title,
  negative,
  positive,
  value,
  onChange,
}: {
  axis: ManeuverAxis
  title: string
  negative: string
  positive: string
  value: number
  onChange: (axis: ManeuverAxis, value: number) => void
}) {
  const setValue = (next: number) => onChange(axis, Math.min(2500, Math.max(-2500, next)))

  return (
    <div className={`maneuver-field maneuver-field--${axis}`}>
      <span><span>{title}</span><b>{signed(value)} m/s</b></span>
      <div className="maneuver-axis-endpoints" aria-hidden="true">
        <small>← {negative}</small>
        <small>{positive} →</small>
      </div>
      <input
        type="range"
        min="-2500"
        max="2500"
        step="1"
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        aria-label={`${negative} to ${positive} delta-v`}
      />
      <div className="maneuver-precision-row">
        <button type="button" onClick={() => setValue(value - 100)}>−100</button>
        <button type="button" onClick={() => setValue(value - 10)}>−10</button>
        <input
          type="number"
          min="-2500"
          max="2500"
          step="1"
          value={Math.round(value)}
          onChange={(event) => setValue(Number(event.target.value) || 0)}
          aria-label={`Exact ${axis} delta-v in meters per second`}
        />
        <button type="button" onClick={() => setValue(value + 10)}>+10</button>
        <button type="button" onClick={() => setValue(value + 100)}>+100</button>
      </div>
    </div>
  )
}

export function SpacecraftManeuverPanel({
  plan,
  preview,
  onBurnPhaseChange,
  onDeltaVChange,
  onCommit,
  onReset,
  onRemove,
}: {
  plan: ClientSpacecraftPlan
  preview: ManeuverPreview
  onBurnPhaseChange: (phase: number) => void
  onDeltaVChange: (axis: ManeuverAxis, deltaV: number) => void
  onCommit: () => void
  onReset: () => void
  onRemove: () => void
}) {
  const burnPercent = Math.round((plan.maneuver.burnPhase / (Math.PI * 2)) * 100)
  const previewOrbit = preview.valid ? preview.orbit : plan.orbit

  return (
    <section className="maneuver-planner glass-panel" aria-label="Spacecraft maneuver planner">
      <div className="maneuver-planner__heading">
        <span>
          <small>LOCAL MANEUVER</small>
          <strong>{plan.name}</strong>
        </span>
        <button type="button" onClick={onRemove} aria-label="Remove local spacecraft">×</button>
      </div>

      <div className="maneuver-planner__status">
        <span>PLANNING MODE</span>
        <small>{plan.launchPlanetName ? `Launched from ${plan.launchPlanetName}` : 'Client-side preview'} · no backend calls</small>
      </div>

      <label className="maneuver-field">
        <span>Burn position <b>{burnPercent}%</b></span>
        <input
          type="range"
          min="0"
          max={Math.PI * 2}
          step="0.01"
          value={plan.maneuver.burnPhase}
          onChange={(event) => onBurnPhaseChange(Number(event.target.value))}
        />
      </label>

      <div className="maneuver-axis-help">
        Drag any of the six arrows on the 3D maneuver node, or use the precise controls below.
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
        <div><dt>Total Δv</dt><dd>{Math.round(preview.deltaVMagnitude)} m/s</dd></div>
        <div><dt>Semi-major</dt><dd>{previewOrbit.semiMajorAxis.toFixed(2)}</dd></div>
        <div><dt>Eccentricity</dt><dd>{previewOrbit.eccentricity.toFixed(3)}</dd></div>
        <div><dt>Inclination</dt><dd>{spacecraftInclinationDegrees(previewOrbit).toFixed(2)}°</dd></div>
      </dl>

      {preview.warning && <p className="maneuver-warning">{preview.warning}</p>}

      <div className="maneuver-planner__actions">
        <button type="button" className="maneuver-secondary" onClick={onReset} disabled={preview.deltaVMagnitude < 0.01}>Reset</button>
        <button type="button" className="maneuver-primary" onClick={onCommit} disabled={!preview.valid || preview.deltaVMagnitude < 0.01}>Adopt preview</button>
      </div>
      <p className="maneuver-planner__note">All six directions are represented as three signed local axes. The temporary preview adapter can later be replaced by your shared Rust→TS orbital library without changing this UI contract.</p>
    </section>
  )
}

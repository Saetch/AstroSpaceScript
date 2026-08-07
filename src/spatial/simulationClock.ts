export interface SimulationClockSample {
  simulationTimeSeconds: number
  timeScale: number
  revision: bigint
}

interface CalibratedClock extends SimulationClockSample {
  receivedAtMilliseconds: number
}

const monotonicNow = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

let clock: CalibratedClock = {
  simulationTimeSeconds: 0,
  timeScale: 1,
  revision: 0n,
  receivedAtMilliseconds: monotonicNow(),
}

/** Apply an authoritative server sample. Between samples, clients extrapolate locally. */
export function applySimulationClockSample(sample: SimulationClockSample): void {
  if (sample.revision < clock.revision) return
  clock = {
    ...sample,
    receivedAtMilliseconds: monotonicNow(),
  }
}

/** Current synchronized simulation time without triggering React renders every frame. */
export function getSimulationTimeSeconds(nowMilliseconds = monotonicNow()): number {
  const elapsedRealSeconds = Math.max(0, nowMilliseconds - clock.receivedAtMilliseconds) / 1000
  return clock.simulationTimeSeconds + elapsedRealSeconds * clock.timeScale
}

export function resetSimulationClock(): void {
  clock = {
    simulationTimeSeconds: 0,
    timeScale: 1,
    revision: 0n,
    receivedAtMilliseconds: monotonicNow(),
  }
}

# Spatial node and orbit model

The backend owns trajectory definitions; clients never own authoritative positions.

## Node hierarchy

Every body is interpreted as a node in a parent-local frame:

- galaxy: root/universe-local position
- star system: parent = galaxy, static galaxy-local position
- planet: parent = star system, system-local orbit
- moon: parent = planet, planet-local orbit

The current database keeps planets and moons in their existing tables. The frontend adapters expose them through the generic `SpatialNode`/`OrbitDefinition` contract in `src/spatial/orbit.ts`. This allows a future migration to one generic node table without changing orbit evaluation or rendering.

## Canonical orbit fields

`orbit_radius` is the semi-major axis in the parent node's local units.

All orbit angles are radians:

- `orbit_offset`: phase at simulation time zero
- `orbit_inclination`: plane tilt
- `orbit_longitude`: longitude of ascending node
- `orbit_argument`: argument of periapsis

`orbit_speed` is radians per simulation second. `orbit_eccentricity` is unitless.

The trajectory is deliberately kinematic rather than physical: phase advances linearly and is mapped onto an ellipse. The exact operation order is implemented in both:

- `spacetimedb/src/spatial/orbit.rs`
- `src/spatial/orbit.ts`

Reducers can evaluate the Rust function whenever authoritative positions are needed. The frontend evaluates the TypeScript function each frame.

## Time synchronization

The private `GameClock` advances simulation time. A public `SimulationClock` sample is replicated four times per second. Clients calibrate to each sample and extrapolate locally between samples through `src/spatial/simulationClock.ts`.

This avoids streaming every body's position while keeping clients and reducers on the same time axis.

## Rendering units

Simulation positions remain in canonical parent-local units. Three.js conversion values live only in `src/spatial/renderScales.ts` and are applied uniformly to a complete local frame. They are presentation settings, not simulation state.

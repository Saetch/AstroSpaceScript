# Shared Universe Galaxy Map

A runnable React + TypeScript prototype for navigating:

1. A backend-driven overview of visible galaxies
2. A clickable full-scale map inside each selected galaxy
3. An animated solar-system orrery
4. A rotatable planet detail view with interactive surface markers

Recent upgrades:

- Simplified multi-galaxy overview with clickable spiral, barred-spiral, elliptical, and irregular galaxy representations
- Backend-owned visible galaxy catalog; adding rows reveals expansion destinations without frontend changes
- Systems are associated with galaxies through `StarSystem.galaxyId`

- 2,400-unit spiral galaxy radius, four times larger than the previous massive version
- 118,000 deterministic background stars in a single point cloud
- Existing systems projected into one local arm region with their relative spacing multiplied by four
- GPU-instanced visitable system beacons and hit targets, with cursor-directed wheel zoom
- Optional camera follow mode for galactic rotation
- Canonical galaxy orientation reset that also re-enables rotation following
- Overview-safe camera clipping and screen-space galaxy stars visible immediately on load
- Backend-configurable colonized zones that tint both territory discs and nearby galaxy stars
- Distance-gated system labels that appear only after zooming into the charted region
- Expanded non-realistic orbital spacing and a wider default solar-system camera
- Seeded procedural planets with oceans, clouds, mountains, craters, and atmospheres
- Numeric per-planet population used to generate urban coverage
- Clustered dark city networks with emissive night-side lights on suitable lowland terrain
- A small capped set of subdued real local point lights for the largest urban clusters
- Terrain-sampled static anomalies, vaults, resources, missions, land settlements, and floating settlements
- Fixed planetary ring orientation while planets orbit and spin independently

The UI currently uses mock data from `src/data/mockUniverse.ts`; it is **not connected to SpaceTimeDB yet**. All rendering consumes a `UniverseRepository` snapshot, and `src/data/spacetime/SpacetimeUniverseRepository.ts` provides the adapter boundary for generated bindings. Replacing the exported mock repository with that repository is the remaining connection step.

## Run it

```bash
npm ci
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

The included `.npmrc` and lockfile use the public npm registry. Node.js 20.19+, 22.12+, or 24.x is supported by this Vite setup.


### Surface feature sizing

Settlement structures are intentionally compact and procedurally varied. The backend can override the size of any individual surface feature without changing its generated layout:

```ts
interface SurfacePoint {
  visualType?: SurfaceVisualType
  visualScale?: number // clamped to 0.35-2.0 by the renderer
}
```


## Fixed-spacing traffic flow

Traffic lanes use a moving world-space slot grid rather than a stretched dash texture.
Adjacent occupied markers remain 46 display units apart on every route. Directional
traffic volume determines how many consecutive slots are occupied before the empty
section of the loop, so low-volume lanes remain visibly sparse without changing marker
spacing or compressing into a continuous line.

## Architecture

- `src/domain/universe.ts`: stable frontend domain model
- `src/data/UniverseRepository.ts`: repository contract and mock source
- `src/data/spacetime/SpacetimeUniverseRepository.ts`: real-time repository shell
- `src/scenes/*`: rendering and interaction only
- `src/App.tsx`: navigation state, HUD, and scene composition

## SpaceTimeDB integration path

The intended flow is:

1. Define public `galaxy`, `star_system`, `planet`, `surface_point`, and optional `presence` tables in the module.
2. Publish the module and generate TypeScript bindings into the frontend.
3. Implement `SpacetimeUniverseAdapter` using the generated `DbConnection`.
4. Subscribe to the relevant tables.
5. On `onApplied`, `onInsert`, `onUpdate`, and `onDelete`, normalize the client cache into `StarSystem[]` and call `onSystemsChanged`.
6. Instantiate `SpacetimeUniverseRepository` instead of `MockUniverseRepository`.

Current SpaceTimeDB 2.x connection shape:

```ts
import { DbConnection, tables } from './module_bindings'

const connection = DbConnection.builder()
  .withUri(import.meta.env.VITE_SPACETIMEDB_URI)
  .withDatabaseName(import.meta.env.VITE_SPACETIMEDB_DATABASE)
  .onConnect((ctx) => {
    ctx.subscriptionBuilder()
      .onApplied(() => rebuildUniverseFromCache(ctx.db))
      .subscribe([
        tables.galaxy,
        tables.starSystem,
        tables.planet,
        tables.surfacePoint,
        tables.presence,
      ])
  })
  .build()
```

Generate bindings after schema changes:

```bash
spacetime generate --lang typescript --out-dir src/module_bindings
```

## Suggested authoritative tables

- `galaxy`: id, name, overview_position_x/y/z, radius, thickness, rotation, morphology, primary_color, secondary_color, description, discovered_by, estimated_systems, seed, visible_to_player
- `star_system`: id, galaxy_id, name, position_x/y/z, primary_kind, spectral_type, color, radius, optional black-hole visual fields, faction, population, optional zone_color, optional zone_radius, optional zone_strength, optional zone_name
- `planet`: id, system_id, orbit_index, orbit_radius, orbit_speed, radius, type, colors, physical stats, population, tidally_locked
- `surface_point`: id, planet_id, latitude, longitude, kind, visual_type, label, description
- `presence`: identity, current_system_id, current_planet_id, last_seen
- `world_event`: id, scope_type, scope_id, event_type, payload, starts_at, ends_at

Store simulation values in normalized game units. Convert them to Three.js scale only in the frontend normalization layer.

## Next production improvements

- Spatial culling and chunk streaming for truly massive galaxies
- Level-of-detail and spatial chunk subscriptions
- URL routes for deep-linking systems and planets
- Texture/GLTF asset pipeline
- Selection permissions and reducer-driven interactions
- Optimistic UI for player actions, reconciled against SpaceTimeDB state


## Merged political territories

Systems with the same normalized `zoneColor` reinforce one continuous influence field. Different colors compete at every point in the galaxy; their frontier moves when backend-provided reach or pressure changes.

```ts
interface StarSystem {
  zoneColor?: string
  zoneRadius?: number
  zoneStrength?: number
  zoneName?: string
}
```

- `zoneColor`: territory identity and painted-map color
- `zoneRadius`: current geographic reach in galaxy render units
- `zoneStrength`: pressure applied within that reach
- `zoneName`: UI label for the merged color group

The mock systems all use the same color and name so they form one large test territory. The overview territory card disappears at the same zoom threshold where individual system labels appear.

Planet inspection keeps the system star visible. Solar-system orbit animation uses a presentation multiplier and does not alter backend orbital values.

## Latest rendering adjustments

- `Planet.tidallyLocked?: boolean` enables synchronous rotation. In the system view the same longitude remains pointed toward the star; in inspection the planet remains fixed toward the visible sun.
- The mock territory radii are intentionally compact (`34`–`42` render units) while remaining backend-configurable through `StarSystem.zoneRadius`.
- Territory textures use a hard ownership threshold and a high-contrast two-pixel border, including borders between competing colors.
- System beacons, stellar glows, planet albedo, and local fill lighting have been raised moderately for readability.


## Data ownership

Backend-owned values are represented by the domain rows: system coordinates and stellar properties; zone color, radius, strength, and name; planet orbit index and physical data; population and tidal locking; and surface-point coordinates, kind, and optional visual type. The mock file currently supplies those rows.

Frontend-owned presentation values include the four-times galaxy display scale, camera limits, marker pixel/readability sizes, orbit animation multiplier, procedural texture resolution, and light/material tuning. Procedural terrain remains deterministic because its fallback seed uses backend system coordinates plus `Planet.orbitIndex`.

`SurfacePoint.visualType` supports:

```ts
'settlement-land' | 'settlement-water' | 'vault' | 'anomaly' | 'resource' | 'mission'
```

When `visualType` is omitted, settlements infer land versus water from the same seeded terrain used to render the planet.

## Climate, economy, and colonization fields

Planet climate is now represented by two backend-owned temperature gradients rather than a single average:

```ts
interface PlanetTemperatureProfile {
  pole: number
  equator: number
  substellar: number
  antistellar: number
}

interface Planet {
  temperature: PlanetTemperatureProfile
}
```

The UI shows both `pole → equator` and `sunward → darkside`, plus the full minimum-to-maximum extent. The procedural climate combines latitude with the sunward gradient. Tidally locked worlds use the sunward gradient strongly; rotating worlds use it only as a smaller day/night modifier.

Polar ice follows the generated terrain classification. Land receives the main irregular cap, while oceans only receive sparse broken sea ice when local temperatures are substantially below freezing. The old uniform white polar tint has been removed. Hot volcanic worlds and gas giants remain excluded.

Planetary economy and ownership are backend-facing fields:

```ts
interface PlanetProduction {
  unit: string
  cycle: string
  industry?: number
  energy?: number
  resources?: number
  fuel?: number
  food?: number
  research?: number
}

interface Planet {
  colonized: boolean
  population: number
  production?: PlanetProduction
}
```

The included `Sable Expanse / Eidolon` test case starts uncolonized and therefore has no zone fields. The mock repository's `colonizePlanet(systemId, planetId)` action simulates the future SpaceTimeDB reducer: it creates a pioneer settlement, initial population and production, and a small territory source. In production, the generated SpaceTimeDB adapter should implement the same repository action and let subscribed rows update the UI.

## Latest interaction updates

- Unclaimed systems are visually distinct in the galaxy registry and system HUD. Their state is derived from backend-owned planet `colonized` values and absence of territorial influence.
- Galaxy navigation uses a map-style control constrained to the galactic X/Z plane. Users can pan across the table and orbit around the current local target rather than only the galactic center.
- Colonization launches a sub-second landing pod sequence. The mock repository mutation is dispatched at surface impact, matching the point where a future SpaceTimeDB reducer should be called.
- Navigation uses a 900 ms transit overlay with a three-craft formation entering from outside the upper-right edge, layered star lanes, and a lower-left route-status display.

The pod animation and transition overlay are frontend presentation. Colonization authority remains in `UniverseRepository.colonizePlanet(systemId, planetId)` and should be implemented by a SpaceTimeDB reducer in production.

## Distant inspection stars

Planet inspection renders the system star far outside the local planet scene. Its apparent angular radius is derived from the backend-owned `starRadius` and the planet's `orbitRadius`, so inner worlds see a larger stellar disc and outer worlds see a smaller one without placing the star next to the planet.

## Inspection sun visibility

Planet inspection stars are rendered 120–220 scene units away. Their materials ignore scene fog, the planet camera supports a 2,400-unit far plane, and the default star direction remains inside the inspection camera framing. Apparent size is still derived from stellar radius and orbital distance.


## Multi-galaxy catalog

The top-level navigation is now:

```text
Known galaxies → galaxy map → star system → planet
```

The authoritative snapshot contains both arrays:

```ts
interface UniverseSnapshot {
  galaxies: Galaxy[]
  systems: StarSystem[]
  // connection metadata...
}

interface StarSystem {
  galaxyId: string
  // system fields...
}
```

Only galaxies included in `UniverseSnapshot.galaxies` are rendered in the overview. A production normalizer can therefore filter the SpaceTimeDB `galaxy` table by visibility, exploration, faction knowledge, or expansion progress before emitting the snapshot. Galaxies may be visible even when they currently have no registered systems; the UI shows that state explicitly and will populate automatically when system rows with the matching `galaxyId` arrive.

The mock catalog includes four visible galaxies. All existing systems belong to `perseus-ledger`; the other galaxies demonstrate future expansion destinations without inventing visitable systems.

## Latest visual corrections

- Restored the compact centered ATLAS navigation transition and replaced the moving fleet with one stationary ship silhouette.
- Rebuilt barred-spiral overview generation as a central bulge, a narrow stellar bar, and two arms that originate at the bar ends.
- Tidally locked climates now generate permanent-night ice beyond the poles. Dark-side continents can become broadly frozen, while ocean ice remains broken and limited.

## Latest rendering corrections

- Rebuilt barred-spiral overview generation as a flat stellar bulge, bar, two open S-shaped arms, and diffuse disc. It no longer uses a 3D capsule glow.
- Centralized the procedural climate-to-mesh longitude convention in `src/procedural/tidalOrientation.ts`.
- Tidally locked planets now point the generated substellar hemisphere toward the actual rendered star in both system and planet views.
- Permanently dark oceans receive stronger but still fractured sea ice at extreme antistellar temperatures.

## Shared galaxy morphology

The universe overview and the selected-galaxy map both use `src/procedural/galaxyGeometry.ts`. The backend-owned morphology, seed, colors, arm count, winding, and bar length therefore drive both representations. The previous twin-galaxy mock has been removed.

Optional galaxy shape fields:

```ts
interface Galaxy {
  armCount?: number
  armWinding?: number
  barLength?: number
}
```

## Moons

Moons are nested authoritative records on a planet:

```ts
interface Moon {
  id: string
  name: string
  type: string
  radius: number
  orbitRadius: number
  orbitSpeed: number
  orbitOffset: number
  color: string
  secondaryColor?: string
  colonized?: boolean
  population?: number
}

interface Planet {
  moons?: Moon[]
}
```

The frontend does not impose a fixed count. Mock terrestrial worlds generally have zero to two moons, while the mock gas and ice giants demonstrate larger moon systems. A backend may provide up to twelve or more if desired.

## Interacting and merging galaxy pairs

Companion galaxies can now carry backend-authored interaction parameters. Both the universe overview and the selected-galaxy renderer consume the same fields and deterministic geometry path.

```ts
interface GalaxyInteraction {
  phase: 'bound' | 'close-pass' | 'merging'
  distortion: number
  bridgeStrength: number
  tailStrength?: number
}

interface GalaxyCompanion {
  // existing companion fields
  interaction?: GalaxyInteraction
}
```

- `offset` determines the current separation of the galaxy centers.
- `distortion` pulls and curls the outer stellar discs.
- `bridgeStrength` controls the density of the stellar bridge.
- `tailStrength` controls the length of the opposing tidal tails.

The Gemini Wake mock is configured as a close, actively merging pair.

## Moon presentation

Moon `orbitRadius` and `orbitSpeed` remain backend-owned values. The frontend applies presentation-only scaling so moon systems remain legible without implying real astronomical scale. This version renders moon orbits about 30% wider and their visible animation about one-third slower than the previous build.

## Interacting galaxy rendering

Active mergers now use a visibly distinct shared composition rather than subtle per-disc parameter changes:

- deeply overlapping, independently tilted stellar discs
- two preserved luminous nuclei
- a broad common stellar envelope
- a wide mixed-color bridge
- broad tidal fans instead of narrow particle ropes

The interaction remains backend-driven through `offset`, `inclination`, and:

```ts
interface GalaxyInteraction {
  phase: 'bound' | 'close-pass' | 'merging'
  distortion: number
  bridgeStrength: number
  tailStrength?: number
  envelopeStrength?: number
}
```


## Backend-defined black holes

A star system can select a black hole as its primary object. The frontend does not simulate gravity, orbital stability, accretion, or damage; those remain backend responsibilities. It only renders the visual parameters supplied in the snapshot.

```ts
interface StarSystem {
  primaryKind?: 'star' | 'black-hole'
  blackHole?: {
    massSolar: number
    eventHorizonRadius: number
    spin: number
    photonRingColor: string
    accretionDisk?: {
      innerRadius: number
      outerRadius: number
      thickness: number
      tilt: [number, number, number]
      innerColor: string
      outerColor: string
      opacity: number
      luminosity: number
      rotationSpeed: number
    }
    jetColor?: string
    jetLength?: number
    jetIntensity?: number
  }
}
```

The mock `Ilyr's Maw` system sits beyond the current system cluster and contains three backend-defined planets. Its renderer uses an event-horizon shadow, photon rings, a procedural accretion disc, and optional jets. Gravitational lensing is intentionally not attempted in this prototype.

## Climate consistency update

- Planet types containing `frozen`, `icy`, or `ice world` resolve to a fully icy surface archetype before generic ocean classification.
- If all four backend climate anchors are below 0 C, the renderer produces near-global land and ocean ice rather than limiting ice to the poles.
- Volcanic worlds remain excluded from procedural ice. Their backend temperature profiles should remain consistent with the intended magma state.

## Six-world mock system

The mock snapshot now includes `Asterion Reach`, a colonized system extending the local Atlas Compact cluster. Its six backend-shaped planet records are ordered from four inner terrestrial/ocean worlds to two outer gas giants. `Orison Prime`, the sixth planet, has a backend-configured ring system and nine moons.

All system, planet, moon, climate, production, territory, and ring values remain data records in `src/data/mockUniverse.ts`; the scene code does not invent the system layout.

## Ocean coverage and giant gravity

Ocean worlds can provide a backend-owned exposed-land target:

```ts
interface Planet {
  landFraction?: number // 0.0 to 0.07 for ocean worlds
  gravity: number       // cloud-top gravity in Earth g for giant planets
}
```

The frontend deterministically samples the seeded terrain and chooses a sea level that leaves approximately the requested land fraction exposed. Ocean-world values are clamped to 7%; `0` creates a complete water world. Giant-planet gravity remains authoritative backend data rather than being derived from display radius.

## Camera-relative star background

The old origin-centered helper star field has been replaced with deterministic layered celestial shells. The shells follow camera translation, so long galaxy-map pans never leave the background behind, while camera rotation still changes the visible star directions naturally. The background stars ignore scene fog and remain behind normal scene geometry.

The former cyan ring around the local system cluster was only a frontend "charted region" navigation helper, not a territory boundary. The ring has been removed; the zoom guidance label remains.

## Backend-defined inter-system traffic

The galaxy snapshot now supports authoritative traffic-route records:

```ts
interface TrafficRoute {
  id: string
  galaxyId: string
  fromSystemId: string
  toSystemId: string
  traffic: number // normalized 0..1
  direction?: 'bidirectional' | 'from-to' | 'to-from'
  kind?: 'civilian' | 'freight' | 'military' | 'research' | 'mixed'
  color?: string
  speed?: number
  laneOffset?: number
  arcHeight?: number
  label?: string
  active?: boolean
}
```

The backend owns route existence, endpoints, direction, load, and optional visual hints. The frontend derives only the curved display path. Routes stop at offset transfer gates instead of entering system centers. Lane segments and moving traffic packets are rendered through shared `InstancedMesh` pools, so higher traffic changes density without creating a React object for every ship.

## Visible traffic-route demo

The mock snapshot currently connects three systems in a high-visibility triangle:

- Sol <-> Vesper Reach: 94%
- Vesper Reach <-> Asterion Reach: 82%
- Asterion Reach <-> Sol: 71%

The corridor ribbons are batched into two screen-space line draws (core + glow), while transfer gates and moving packets remain GPU-instanced. This keeps routes readable at the default galaxy camera distance without creating one React object per ship.

## Traffic presentation

Traffic routes remain backend records. The frontend renders them as shallow offset corridors rather than tall arcs. Animated directional arrow packets appear only after zooming to the system-label level, so bidirectional and one-way flow is readable without cluttering the full-galaxy overview. `laneOffset` and `arcHeight` are presentation hints and are clamped to conservative ranges for map readability.

## Traffic-route presentation

Traffic lanes use shallow quadratic transfer curves, keeping routes smooth and nearly straight even for awkward system layouts. The illuminated dash pattern loops continuously in the backend-configured travel direction. Bidirectional routes use two separated lanes whose flow moves in opposite directions. Transfer gates and close-range traffic packets remain GPU-instanced.

## Asymmetric traffic volume

A bidirectional route may provide independent backend loads for each direction:

```ts
{
  fromSystemId: 'sol',
  toSystemId: 'vesper',
  traffic: 0.8,
  trafficFromTo: 0.8,
  trafficToFrom: 0.15,
  direction: 'bidirectional',
}
```

Each rendered lane uses its own load for dash spacing, brightness, packet count, and speed. `traffic` remains the fallback for older records.

## Traffic visibility correction

Traffic routes are represented by GPU-batched point sprites rather than a continuous screen-space line. The markers have a fixed 14-unit world-space separation along each lane and a fixed pixel size on screen, so they remain visible from the default galaxy camera. Directional volume controls how many consecutive marker slots are occupied; the occupied group loops continuously along the route.

## Orbital inclination and moon focus

Planet and moon orbit planes now accept backend-owned inclination values in degrees:

```ts
interface Planet {
  orbitInclination?: number
}

interface Moon {
  orbitInclination?: number
}
```

The mock repository assigns deterministic values from approximately -5 to +10 degrees. The system scene applies a planet's inclination to both its orbit ring and orbital position. Moon inclination is applied locally relative to the parent planet's orbit plane.

Moons are clickable in both the solar-system and planet-inspection scenes. Selection moves the existing camera and OrbitControls target to the moon without changing routes, remounting the Canvas, or showing a loading transition. The camera continues following the moon's orbital translation while still allowing local orbit and zoom controls. The on-screen `Return to overview` action eases the camera back to the scene's initial camera and target.

System-view planets now use a higher-resolution procedural texture, denser sphere geometry, visible terrain displacement, stronger bump detail, and atmosphere opacity closer to the inspection view. Both views still use the same seed and surface-generation algorithm; the remaining quality difference is a deliberate performance tradeoff.

## Always-visible planets in system view

The system overview uses presentation-only survey lighting so distant planets remain readable regardless of their orbital position:

- planet, cloud, atmosphere, and ring materials ignore system-view fog
- system fog begins beyond the playable orbital layout
- a soft camera-relative fill light illuminates the camera-facing hemisphere
- the system primary still supplies the dominant color and day/night direction

Planet inspection retains the normal close-up fog and physically directional shading.

## Selectable supermassive galactic core

The mock Perseus Ledger now includes a backend-shaped galactic-core system record named **The Sovereign Dark**. It uses the same `StarSystem` and `BlackHoleConfig` records as other compact-object systems, with one extra map role:

```ts
interface StarSystem {
  mapRole?: 'standard' | 'galactic-core'
  primaryKind?: 'star' | 'black-hole'
  blackHole?: BlackHoleConfig
}
```

A `galactic-core` record is positioned at the center of the selected galaxy map, rendered at a much larger presentation scale, and remains selectable like a normal system. Clicking it opens the existing system inspection view. Its event horizon, accretion disc, photon ring, jets, mass, spin, and colors are all supplied by the repository snapshot; the frontend only animates and presents those values.

## Galactic core presentation

The galactic-core black hole uses the same backend `BlackHoleConfig` as its system inspection view. On the galaxy map, the frontend applies a compact presentation scale so its visible accretion disc is no more than roughly three ordinary system-beacon radii. The mock accretion flow uses `rotationSpeed: 1.7`, making the disc substantially faster and more active than before.

## Black-hole lensing pipeline

Selected black-hole systems use `BlackHoleLensingPass`:

1. Render the scene to an offscreen framebuffer with black-hole foreground objects hidden.
2. Draw a camera-facing lens surface that samples the captured scene.
3. Deflect the captured background using a thin-lens point-mass approximation.
4. Render the event horizon, accretion disc, photon ring, and jets normally in front.

Backend presentation fields:

```ts
blackHole: {
  lensingStrength?: number
  lensingRadiusMultiplier?: number
}
```

This is real screen-space scene warping, not transparent halo geometry. It is still an approximation rather than numerical Kerr geodesic integration.

## Black-hole lensing revision

The selected black-hole system uses a captured-scene thin-lens pass. The offscreen capture includes the accretion disc and surrounding scene but excludes the event horizon and jets. A camera-facing lens surface warps that capture, after which the event horizon is drawn on top. Decorative halo and photon-ring geometry have been removed. The compact galactic-core marker is static relative to the galaxy and does not animate its disc texture.

Map-level lensing is intentionally disabled: at the compact marker scale it is visually ambiguous and would require a second scene render every frame on the already large galaxy map.

## Lensing pipeline correction

The accretion disc is now rendered only into the offscreen capture used by the lens shader. The original disc geometry is hidden for the final scene render, preventing a duplicate unwarped disc from appearing underneath the lensed version. The mock galactic-core lensing radius multiplier is also increased so distortion extends farther beyond the accretion disc.

## Latest rendering corrections

- Black-hole accretion discs now use one physical ring mesh before the lensing capture. The previous two-layer disc geometry made both black holes look like they had duplicated discs after lensing.
- Galaxy and planet views use brighter camera-centered starfields with slightly larger point sizes and stronger secondary stars. Universe-overview and system-view starfield settings remain unchanged.

## Lensing pipeline correction

The black-hole pass now uses two render targets:

- a color capture containing the background and accretion disc
- a second depth capture excluding all black-hole geometry

The final lens shader renders only the warped capture rather than blending the original disc into it. It discards lens pixels wherever an ordinary scene body is closer to the camera than the black hole, so foreground planets and moons remain unwarped and also occlude the event horizon normally.

## Lensing compositing correction

The system-view lens pass now tags planets and moons as `blackHoleLensingBody` objects. Bodies closer to the camera than the black hole are omitted from the offscreen lens capture and restored for the final depth-tested render. The shader uses the primary point-mass image only, avoiding the mirrored secondary branch that previously made the accretion disc appear twice.

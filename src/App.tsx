import { GizmoHelper, GizmoViewport, MapControls, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MOUSE, MathUtils } from 'three'
import type { PlanetTemperatureProfile, SurfacePoint, ViewState } from './domain/universe'
import { useUniverse } from './data/useUniverse'
import { universeRepository } from './data/UniverseRepository'
import { SceneEnvironment } from './components/SceneEnvironment'
import { GalaxyOverviewScene } from './scenes/GalaxyOverviewScene'
import { GalaxyScene } from './scenes/GalaxyScene'
import { PlanetScene } from './scenes/PlanetScene'
import { SolarSystemScene } from './scenes/SolarSystemScene'
import { buildPlanetSeedKey } from './procedural/planetSeed'
import { getSystemPrimaryColor, getSystemPrimaryLabel, isBlackHoleSystem, isGalacticCoreSystem } from './components/SystemPrimary'

const productionPresentation = [
  { key: 'industry', label: 'Industry', icon: 'IND' },
  { key: 'energy', label: 'Energy', icon: 'PWR' },
  { key: 'resources', label: 'Resources', icon: 'RAW' },
  { key: 'fuel', label: 'Fuel', icon: 'FUEL' },
  { key: 'food', label: 'Food', icon: 'BIO' },
  { key: 'research', label: 'Research', icon: 'R&D' },
] as const

function formatProduction(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatTemperature(value: number) {
  return `${Math.round(value)} °C`
}

function temperatureExtent(temperature: PlanetTemperatureProfile) {
  const values = [temperature.pole, temperature.equator, temperature.substellar, temperature.antistellar]
  return `${Math.round(Math.min(...values))} to ${Math.round(Math.max(...values))} °C`
}

function connectionLabel(connection: ReturnType<typeof useUniverse>['connection']) {
  if (connection === 'live') return 'SpaceTimeDB live'
  if (connection === 'connecting') return 'Connecting'
  if (connection === 'offline') return 'Offline cache'
  return 'Mock universe'
}

export default function App() {
  const universe = useUniverse()
  const [view, setView] = useState<ViewState>({ type: 'universe' })
  const [selectedPoint, setSelectedPoint] = useState<SurfacePoint>()
  const [panelOpen, setPanelOpen] = useState(true)
  const [followGalaxyRotation, setFollowGalaxyRotation] = useState(true)
  const [galaxyOrientationReset, setGalaxyOrientationReset] = useState(0)
  const [galaxyLabelsVisible, setGalaxyLabelsVisible] = useState(false)
  const [colonizingPlanetId, setColonizingPlanetId] = useState<string>()
  const [colonizationError, setColonizationError] = useState<string>()
  const [colonizationSequence, setColonizationSequence] = useState(0)
  const [transitionLabel, setTransitionLabel] = useState<string>()
  const transitionTimer = useRef<number | undefined>(undefined)

  const galaxy = useMemo(
    () => (view.type === 'universe' ? undefined : universe.galaxies.find((item) => item.id === view.galaxyId)),
    [universe.galaxies, view],
  )
  const galaxySystems = useMemo(
    () => (galaxy ? universe.systems.filter((item) => item.galaxyId === galaxy.id) : []),
    [galaxy, universe.systems],
  )
  const galaxyTrafficRoutes = useMemo(
    () => (galaxy ? universe.trafficRoutes.filter((route) => route.galaxyId === galaxy.id && route.active !== false) : []),
    [galaxy, universe.trafficRoutes],
  )
  const system = useMemo(
    () => (view.type === 'system' || view.type === 'planet'
      ? universe.systems.find((item) => item.id === view.systemId)
      : undefined),
    [universe.systems, view],
  )
  const planet = useMemo(
    () => (view.type === 'planet' ? system?.planets.find((item) => item.id === view.planetId) : undefined),
    [system, view],
  )
  const systemIsCore = system ? isGalacticCoreSystem(system) : false
  const systemColonized = systemIsCore ? false : system?.planets.some((item) => item.colonized) ?? false
  const systemClaimed = !systemIsCore && Boolean(system?.zoneColor && system?.zoneRadius)

  useEffect(() => () => {
    if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current)
  }, [])

  const planetSeedKey = useMemo(() => {
    if (!system || !planet) return undefined
    const planetIndex = system.planets.findIndex((item) => item.id === planet.id)
    return buildPlanetSeedKey(system.position, planet.orbitIndex ?? planetIndex)
  }, [planet, system])

  const territorySummaries = useMemo(() => {
    const groups = new Map<string, {
      color: string
      name: string
      systems: number
      strength: number
      reach: number
    }>()

    galaxySystems.forEach((item) => {
      if (!item.zoneColor || !item.zoneRadius) return
      const key = item.zoneColor.toLowerCase()
      const current = groups.get(key)
      if (current) {
        current.systems += 1
        current.strength += item.zoneStrength ?? 1
        current.reach = Math.max(current.reach, item.zoneRadius)
      } else {
        groups.set(key, {
          color: item.zoneColor,
          name: item.zoneName ?? item.faction,
          systems: 1,
          strength: item.zoneStrength ?? 1,
          reach: item.zoneRadius,
        })
      }
    })

    return [...groups.values()].sort((a, b) => b.strength - a.strength)
  }, [galaxySystems])

  const systemCameraDistance = useMemo(() => {
    if (!system) return 42
    if (isGalacticCoreSystem(system)) {
      const diskRadius = system.blackHole?.accretionDisk?.outerRadius ?? 18
      return MathUtils.clamp(diskRadius * 9.2, 155, 260)
    }
    const outerOrbit = Math.max(...system.planets.map((candidate) => candidate.orbitRadius), 8)
    return MathUtils.clamp(outerOrbit * 2.35 * 1.18, 42, 96)
  }, [system])

  const camera =
    view.type === 'universe'
      ? { position: [0, 690, 980] as [number, number, number], fov: 46, near: 0.1, far: 5000 }
      : view.type === 'galaxy'
        ? { position: [0, 3440, 5520] as [number, number, number], fov: 46, near: 0.1, far: 24000 }
        : view.type === 'system'
          ? { position: [0, systemCameraDistance * 0.56, systemCameraDistance] as [number, number, number], fov: 46, near: 0.1, far: systemIsCore ? 1800 : 700 }
          : { position: [0, 1.2, 9] as [number, number, number], fov: 42, near: 0.1, far: 2400 }

  function transitionTo(nextView: ViewState, label: string) {
    if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current)
    setTransitionLabel(label)
    window.requestAnimationFrame(() => setView(nextView))
    transitionTimer.current = window.setTimeout(() => setTransitionLabel(undefined), 560)
  }

  function openUniverse() {
    setSelectedPoint(undefined)
    transitionTo({ type: 'universe' }, 'Resolving known-galaxy catalog')
  }

  function openGalaxy(galaxyId: string) {
    const nextGalaxy = universe.galaxies.find((item) => item.id === galaxyId)
    setSelectedPoint(undefined)
    setGalaxyLabelsVisible(false)
    transitionTo({ type: 'galaxy', galaxyId }, `Reconstructing ${nextGalaxy?.name ?? 'galaxy'}`)
    setPanelOpen(true)
  }

  function openSystem(systemId: string) {
    const nextSystem = universe.systems.find((item) => item.id === systemId)
    if (!nextSystem) return
    setSelectedPoint(undefined)
    transitionTo(
      { type: 'system', galaxyId: nextSystem.galaxyId, systemId },
      `Resolving ${nextSystem.name}`,
    )
    setPanelOpen(true)
  }

  function openPlanet(planetId: string) {
    if (!system) return
    const nextPlanet = system.planets.find((item) => item.id === planetId)
    setSelectedPoint(undefined)
    setColonizationError(undefined)
    transitionTo(
      { type: 'planet', galaxyId: system.galaxyId, systemId: system.id, planetId },
      `Loading ${nextPlanet?.name ?? 'planet'} survey`,
    )
    setPanelOpen(true)
  }

  function beginColonization() {
    if (!planet || planet.colonized || colonizingPlanetId) return
    setColonizationError(undefined)
    setColonizingPlanetId(planet.id)
    setColonizationSequence((value) => value + 1)
  }

  async function completeColonizationImpact() {
    if (!system || !planet || planet.colonized) return
    try {
      await universeRepository.colonizePlanet(system.id, planet.id)
    } catch (error) {
      setColonizationError(error instanceof Error ? error.message : 'Colonization request failed.')
    } finally {
      window.setTimeout(() => setColonizingPlanetId(undefined), 180)
    }
  }

  return (
    <main className="app-shell">
      <Canvas
        key={`${view.type}-${galaxy?.id ?? 'catalog'}-${system?.id ?? 'root'}-${planet?.id ?? ''}`}
        camera={camera}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <SceneEnvironment mode={view.type} />
        {view.type === 'universe' && (
          <GalaxyOverviewScene galaxies={universe.galaxies} onOpenGalaxy={openGalaxy} />
        )}
        {view.type === 'galaxy' && galaxy && (
          <GalaxyScene
            galaxy={galaxy}
            systems={galaxySystems}
            trafficRoutes={galaxyTrafficRoutes}
            followRotation={followGalaxyRotation}
            resetOrientationToken={galaxyOrientationReset}
            onLabelsVisibilityChange={setGalaxyLabelsVisible}
            onOpenSystem={openSystem}
          />
        )}
        {view.type === 'system' && system && <SolarSystemScene system={system} onOpenPlanet={openPlanet} />}
        {view.type === 'planet' && planet && (
          <PlanetScene
            system={system!}
            planet={planet}
            seedKey={planetSeedKey ?? `${system?.id ?? 'unknown'}::0`}
            selectedPointId={selectedPoint?.id}
            colonizationSequence={colonizingPlanetId === planet.id ? colonizationSequence : 0}
            onColonizationImpact={completeColonizationImpact}
            onSelectPoint={setSelectedPoint}
          />
        )}

        {view.type === 'universe' ? (
          <MapControls
            makeDefault
            enableDamping
            minDistance={260}
            maxDistance={2200}
            minPolarAngle={0.3}
            maxPolarAngle={Math.PI / 2 - 0.1}
            dampingFactor={0.055}
            screenSpacePanning={false}
            mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
            zoomToCursor
          />
        ) : view.type === 'galaxy' ? (
          <MapControls
            makeDefault
            enableDamping
            minDistance={110}
            maxDistance={10400}
            minPolarAngle={0.24}
            maxPolarAngle={Math.PI / 2 - 0.08}
            dampingFactor={0.055}
            screenSpacePanning={false}
            mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
            zoomToCursor
          />
        ) : (
          <OrbitControls
            makeDefault
            enablePan={view.type !== 'planet'}
            minDistance={view.type === 'planet' ? 0.7 : 0.85}
            maxDistance={view.type === 'system' ? 170 : 15}
            minPolarAngle={0.22}
            maxPolarAngle={Math.PI - 0.22}
            dampingFactor={0.055}
            zoomToCursor
          />
        )}
        <GizmoHelper alignment="bottom-right" margin={[84, 84]}>
          <GizmoViewport axisColors={['#e26d7c', '#67d89d', '#6f91ff']} labelColor="white" />
        </GizmoHelper>
      </Canvas>

      <div className={`scene-transition ${transitionLabel ? 'scene-transition--active' : ''}`} aria-hidden={!transitionLabel}>
        <svg className="scene-transition__ship" viewBox="0 0 140 72" aria-hidden="true">
          <defs>
            <linearGradient id="transition-hull" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e9f6ff" />
              <stop offset="0.48" stopColor="#7694ad" />
              <stop offset="1" stopColor="#17283a" />
            </linearGradient>
            <linearGradient id="transition-wing" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#91aec5" />
              <stop offset="1" stopColor="#1b3044" />
            </linearGradient>
          </defs>
          <path className="scene-transition__ship-wing" fill="url(#transition-wing)" d="M57 31 15 8 34 35 15 64 58 43Z" />
          <path className="scene-transition__ship-wing" fill="url(#transition-wing)" d="M83 31 125 8 106 35 125 64 82 43Z" />
          <path className="scene-transition__ship-hull" fill="url(#transition-hull)" d="M70 3 88 31 82 58 70 69 58 58 52 31Z" />
          <path className="scene-transition__ship-cockpit" d="M70 13 79 32 75 43 65 43 61 32Z" />
          <circle className="scene-transition__ship-engine" cx="61" cy="57" r="3" />
          <circle className="scene-transition__ship-engine" cx="79" cy="57" r="3" />
        </svg>
        <div className="scene-transition__reticle"><i /><i /><i /></div>
        <strong>{transitionLabel ?? 'Resolving scene'}</strong>
        <span>ATLAS NAVIGATION</span>
      </div>

      <header className="topbar glass-panel">
        <button className="brand" onClick={openUniverse}>
          <span className="brand__mark">A</span>
          <span>
            <strong>ATLAS</strong>
            <small>SHARED UNIVERSE</small>
          </span>
        </button>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button onClick={openUniverse}>Galaxies</button>
          {galaxy && (
            <>
              <span>/</span>
              <button onClick={() => openGalaxy(galaxy.id)}>{galaxy.name}</button>
            </>
          )}
          {system && (
            <>
              <span>/</span>
              <button onClick={() => openSystem(system.id)}>{system.name}</button>
            </>
          )}
          {planet && (
            <>
              <span>/</span>
              <strong>{planet.name}</strong>
            </>
          )}
        </nav>
        <div className="network-state">
          <span className={`status-dot status-dot--${universe.connection}`} />
          <span>{connectionLabel(universe.connection)}</span>
          <strong>{universe.onlinePlayers} online</strong>
        </div>
      </header>

      {view.type === 'planet' && galaxy && (
        <button className="planet-galaxy-return glass-panel" onClick={() => openGalaxy(galaxy.id)}>
          <span>←</span>
          <span>
            <small>RETURN TO GALAXY</small>
            <strong>{galaxy.name}</strong>
          </span>
        </button>
      )}

      <section className={`scene-title ${view.type === 'planet' ? 'scene-title--with-return' : ''}`}>
        <span className="eyebrow">
          {view.type === 'universe'
            ? 'KNOWN-GALAXY MAP'
            : view.type === 'galaxy'
              ? 'GALACTIC MAP'
              : view.type === 'system'
                ? (systemIsCore ? 'GALACTIC CORE' : systemColonized ? 'SYSTEM ORRERY' : 'UNCLAIMED SYSTEM')
                : 'PLANETARY SURVEY'}
        </span>
        <h1>
          {view.type === 'universe'
            ? 'The Observable Frontier'
            : view.type === 'galaxy'
              ? galaxy?.name
              : view.type === 'system'
                ? system?.name
                : planet?.name}
        </h1>
        <p>
          {view.type === 'universe'
            ? 'Select a visible galaxy to enter its local map. The backend controls which galaxies are currently known to the player.'
            : view.type === 'galaxy'
              ? (galaxySystems.length > 0
                ? 'A full-scale galaxy surrounds its highlighted charted region. Zoom toward registered systems to reveal their names.'
                : 'This galaxy is visible to the player, but no local navigation anchors or system registry have been unlocked yet.')
              : view.type === 'system'
                ? (systemIsCore
                  ? 'Inspect the supermassive singularity, its incandescent accretion flow, photon ring, and polar jets.'
                  : systemColonized
                    ? 'Select a world to open its seeded procedural survey view.'
                    : 'No permanent population or territorial claim is registered here. Survey a candidate world to establish the first colony.')
                : 'Drag to orbit. City lights are population-driven and remain visible across the night side.'}
        </p>
      </section>

      {view.type === 'galaxy' && !galaxyLabelsVisible && territorySummaries.length > 0 && (
        <section className="territory-overview glass-panel">
          <div className="territory-overview__heading">
            <span>MERGED TERRITORIES</span>
            <strong>{territorySummaries.length}</strong>
          </div>
          {territorySummaries.map((territory) => (
            <div className="territory-overview__zone" key={territory.color}>
              <i style={{ background: territory.color, boxShadow: `0 0 18px ${territory.color}` }} />
              <span>
                <strong>{territory.name}</strong>
                <small>{territory.systems} anchors · {territory.strength.toFixed(1)} influence · {territory.reach} reach</small>
              </span>
            </div>
          ))}
          <p>Systems with the same color reinforce one merged field. Competing colors resolve their frontier from reach and influence.</p>
        </section>
      )}

      {view.type === 'galaxy' && (
        <div className="galaxy-map-controls">
          <button
            className={`rotation-follow ${followGalaxyRotation ? 'rotation-follow--active' : ''}`}
            onClick={() => setFollowGalaxyRotation((value) => !value)}
            aria-pressed={followGalaxyRotation}
          >
            <span className="rotation-follow__icon">↻</span>
            {followGalaxyRotation ? 'Following galactic rotation' : 'Follow galactic rotation'}
          </button>
          <button
            className="orientation-reset"
            onClick={() => {
              setFollowGalaxyRotation(true)
              setGalaxyOrientationReset((value) => value + 1)
            }}
          >
            <span>⌖</span>
            Reset map orientation
          </button>
        </div>
      )}

      <button className="panel-toggle" onClick={() => setPanelOpen((value) => !value)} aria-expanded={panelOpen}>
        {panelOpen ? 'Hide intel' : 'Show intel'}
      </button>

      {panelOpen && (
        <aside className="info-panel glass-panel">
          {view.type === 'universe' && (
            <>
              <div className="panel-heading">
                <span>Visible catalog</span>
                <strong>{universe.galaxies.length} galaxies</strong>
              </div>
              <p className="panel-copy">
                This list is authoritative snapshot data. Adding or removing a galaxy in the backend changes which destinations appear here.
              </p>
              <div className="galaxy-list">
                {universe.galaxies.map((item) => {
                  const registeredSystems = universe.systems.filter((systemItem) => systemItem.galaxyId === item.id).length
                  return (
                    <button key={item.id} onClick={() => openGalaxy(item.id)}>
                      <i style={{ background: item.primaryColor, boxShadow: `0 0 20px ${item.primaryColor}` }} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.companions?.length ? `${item.morphology} group · ${item.companions.length + 1} members` : item.morphology} · {item.estimatedSystems}</small>
                      </span>
                      <b>{registeredSystems > 0 ? `${registeredSystems} mapped` : 'VISIBLE'}</b>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {view.type === 'galaxy' && galaxy && (
            <>
              <div className="panel-heading">
                <span>{galaxy.morphology}</span>
                <strong>{galaxy.estimatedSystems}</strong>
              </div>
              <p className="panel-copy">{galaxy.description}</p>
              <dl className="fact-grid">
                <div><dt>Cataloged by</dt><dd>{galaxy.discoveredBy}</dd></div>
                <div><dt>Registered systems</dt><dd>{galaxySystems.length}</dd></div>
                <div><dt>Galaxy members</dt><dd>{1 + (galaxy.companions?.length ?? 0)}</dd></div>
                <div><dt>Traffic routes</dt><dd>{galaxyTrafficRoutes.length}</dd></div>
              </dl>
              {galaxy.companions && galaxy.companions.length > 0 && (
                <section className="moon-roster">
                  <span>{galaxy.companions.some((companion) => companion.interaction?.phase !== undefined && companion.interaction.phase !== 'bound') ? 'INTERACTING COMPANIONS' : 'BOUND COMPANIONS'}</span>
                  <div>
                    {galaxy.companions.map((companion) => (
                      <small key={companion.id}>
                        {companion.name} · {companion.morphology}
                        {companion.interaction ? ` · ${companion.interaction.phase}` : ''}
                      </small>
                    ))}
                  </div>
                </section>
              )}
              {galaxyTrafficRoutes.length > 0 && (
                <section className="traffic-network">
                  <div className="traffic-network__heading">
                    <span>INTER-SYSTEM TRAFFIC</span>
                    <small>{galaxyTrafficRoutes.length} active routes</small>
                  </div>
                  <div className="traffic-network__routes">
                    {galaxyTrafficRoutes.map((route) => {
                      const from = galaxySystems.find((candidate) => candidate.id === route.fromSystemId)
                      const to = galaxySystems.find((candidate) => candidate.id === route.toSystemId)
                      if (!from || !to) return null
                      const fallbackLoad = Math.min(1, Math.max(0, route.traffic))
                      const fromToLoad = Math.round(Math.min(1, Math.max(0, route.trafficFromTo ?? fallbackLoad)) * 100)
                      const toFromLoad = Math.round(Math.min(1, Math.max(0, route.trafficToFrom ?? fallbackLoad)) * 100)
                      const directionalLoads = route.direction === 'bidirectional'
                        && (route.trafficFromTo !== undefined || route.trafficToFrom !== undefined)
                      return (
                        <div key={route.id} className="traffic-network__route">
                          <i style={{ background: route.color ?? '#79dfff', boxShadow: `0 0 14px ${route.color ?? '#79dfff'}` }} />
                          <span>
                            <strong>{route.label ?? `${from.name}–${to.name}`}</strong>
                            <small>{route.direction === 'from-to' ? `${from.name} → ${to.name}` : route.direction === 'to-from' ? `${to.name} → ${from.name}` : `${from.name} ↔ ${to.name}`} · {route.kind ?? 'mixed'}</small>
                          </span>
                          {directionalLoads ? (
                            <b className="traffic-network__loads">
                              <em>{fromToLoad}% →</em>
                              <em>← {toFromLoad}%</em>
                            </b>
                          ) : (
                            <b>{Math.round(fallbackLoad * 100)}%</b>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p>Lane curves stop at offset transfer gates. Traffic load controls packet density and route brightness.</p>
                </section>
              )}

              {galaxySystems.length > 0 ? (
                <div className="system-list">
                  {galaxySystems.map((item) => {
                    const galacticCore = isGalacticCoreSystem(item)
                    const colonized = item.planets.some((candidate) => candidate.colonized)
                    return (
                      <button key={item.id} className={galacticCore ? 'system-list__core' : !colonized ? 'system-list__unclaimed' : undefined} onClick={() => openSystem(item.id)}>
                        <span className="star-swatch" style={{ background: getSystemPrimaryColor(item) }} />
                        <span>
                          <strong>{item.name}</strong>
                          <small>{galacticCore ? `${getSystemPrimaryLabel(item)} · galactic center` : isBlackHoleSystem(item) ? `${getSystemPrimaryLabel(item)} · ${colonized ? item.faction : 'unclaimed'}` : colonized ? item.faction : 'Unclaimed · colonization candidate'}</small>
                        </span>
                        <b>{galacticCore ? 'CORE' : colonized ? item.planets.length : 'OPEN'}</b>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-registry">
                  <span>NO LOCAL REGISTRY</span>
                  <strong>Galaxy visible, systems unavailable</strong>
                  <p>Expansion or survey progress can later add star systems under this galaxy ID through the backend snapshot.</p>
                </div>
              )}
            </>
          )}

          {view.type === 'system' && system && (
            <>
              <div className="panel-heading">
                <span>{getSystemPrimaryLabel(system)}</span>
                <strong>{systemIsCore ? 'Galactic center' : systemColonized ? system.population : 'No residents'}</strong>
              </div>
              <p className="panel-copy">{system.description}</p>
              <div className={`system-claim-state ${systemIsCore ? 'system-claim-state--core' : systemClaimed ? 'system-claim-state--claimed' : 'system-claim-state--open'}`}>
                <span>{systemIsCore ? 'CORE CLASSIFICATION' : systemClaimed ? 'TERRITORIAL STATUS' : 'COLONIZATION STATUS'}</span>
                <strong>{systemIsCore ? 'Supermassive central singularity' : systemClaimed ? (system.zoneName ?? system.faction) : 'Outside every registered territory'}</strong>
                <small>{systemIsCore ? 'A backend-defined galactic landmark. It is selectable like a system, but is not colonizable.' : systemClaimed ? 'This system contributes influence to its merged territorial field.' : `${system.planets.filter((candidate) => !candidate.colonized).length} uncolonized world available for survey.`}</small>
              </div>
              <dl className="fact-grid">
                <div><dt>Authority</dt><dd>{systemIsCore ? 'Core registry' : systemColonized ? system.faction : 'None'}</dd></div>
                <div><dt>Worlds</dt><dd>{system.planets.length}</dd></div>
                <div><dt>Primary</dt><dd>{isBlackHoleSystem(system) ? 'Black hole' : 'Star'}</dd></div>
                {isBlackHoleSystem(system) && system.blackHole && (
                  <>
                    <div><dt>Mass</dt><dd>{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(system.blackHole.massSolar)} M☉</dd></div>
                    <div><dt>Spin</dt><dd>{system.blackHole.spin.toFixed(2)}</dd></div>
                    <div><dt>Accretion</dt><dd>{system.blackHole.accretionDisk ? 'Active disc' : 'Quiescent'}</dd></div>
                  </>
                )}
              </dl>
              {system.planets.length > 0 ? (
                <div className="system-list">
                  {system.planets.map((item) => (
                    <button key={item.id} onClick={() => openPlanet(item.id)}>
                      <span className="planet-swatch" style={{ background: item.color }} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.type}</small>
                      </span>
                      <b>↗</b>
                    </button>
                  ))}
                </div>
              ) : systemIsCore ? (
                <div className="core-warning-card">
                  <span>NO STABLE PLANETARY ORBITS REGISTERED</span>
                  <strong>Relativistic exclusion zone</strong>
                  <p>The accretion flow and core dynamics are rendered from backend parameters. No gameplay simulation is performed by the frontend.</p>
                </div>
              ) : null}
            </>
          )}

          {view.type === 'planet' && planet && (
            <>
              <div className="panel-heading">
                <span>{planet.type}</span>
                <strong>{temperatureExtent(planet.temperature)}</strong>
              </div>
              <p className="panel-copy">{planet.description}</p>
              <dl className="fact-grid">
                <div><dt>Gravity</dt><dd>{planet.gravity} g</dd></div>
                <div><dt>Atmosphere</dt><dd>{planet.atmosphere}</dd></div>
                {planet.landFraction !== undefined && (
                  <div><dt>Exposed land</dt><dd>{(Math.min(0.07, Math.max(0, planet.landFraction)) * 100).toFixed(1)}%</dd></div>
                )}
                <div><dt>Pole → equator</dt><dd>{formatTemperature(planet.temperature.pole)} → {formatTemperature(planet.temperature.equator)}</dd></div>
                <div><dt>Sunward → darkside</dt><dd>{formatTemperature(planet.temperature.substellar)} → {formatTemperature(planet.temperature.antistellar)}</dd></div>
                <div><dt>Discoverer</dt><dd>{planet.discoveredBy}</dd></div>
                <div><dt>Population</dt><dd>{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(planet.population)}</dd></div>
                <div><dt>Moons</dt><dd>{planet.moons?.length ?? 0}</dd></div>
                <div><dt>Sites</dt><dd>{planet.surfacePoints.length}</dd></div>
                <div><dt>Seed</dt><dd>{planetSeedKey ?? 'pending'}</dd></div>
              </dl>
              <div className={`colonization-state ${planet.colonized ? 'colonization-state--active' : 'colonization-state--open'}`}>
                <span>{planet.colonized ? 'COLONIZED WORLD' : 'UNCLAIMED WORLD'}</span>
                <strong>{planet.colonized ? `${formatProduction(planet.population)} residents` : 'No permanent population'}</strong>
              </div>

              {planet.colonized && planet.production && (
                <section className="production-panel">
                  <div className="production-panel__heading">
                    <span>PLANETARY OUTPUT</span>
                    <small>per {planet.production.cycle} · {planet.production.unit}</small>
                  </div>
                  <div className="production-grid">
                    {productionPresentation.map((metric) => {
                      const value = planet.production?.[metric.key]
                      if (value === undefined) return null
                      return (
                        <div key={metric.key} className={`production-metric production-metric--${metric.key}`}>
                          <i>{metric.icon}</i>
                          <span>{metric.label}</span>
                          <strong>{formatProduction(value)}</strong>
                          <small>{planet.production?.unit}/{planet.production?.cycle}</small>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {!planet.colonized && (
                <section className="colonize-card">
                  <span>COLONIZATION CANDIDATE</span>
                  <strong>Establish a permanent foothold</strong>
                  <p>This mock action represents a backend reducer. It creates a pioneer settlement, initial population, starter production, and territorial influence.</p>
                  <button onClick={beginColonization} disabled={colonizingPlanetId === planet.id}>
                    {colonizingPlanetId === planet.id ? 'Colony pod inbound…' : 'Colonize planet'}
                  </button>
                  {colonizationError && <small>{colonizationError}</small>}
                </section>
              )}

              {planet.moons && planet.moons.length > 0 && (
                <section className="moon-roster">
                  <span>ORBITAL SATELLITES</span>
                  <div>
                    {planet.moons.map((moon) => (
                      <small key={moon.id}>{moon.name} · {moon.type}</small>
                    ))}
                  </div>
                </section>
              )}
              <div className="resource-row">
                {planet.resources.map((resource) => <span key={resource}>{resource}</span>)}
              </div>
              <div className="surface-card">
                <span>{selectedPoint ? selectedPoint.kind : 'SURFACE INTELLIGENCE'}</span>
                <strong>{selectedPoint?.label ?? 'Select a cyan marker'}</strong>
                <p>{selectedPoint?.description ?? 'Terrain and urban clusters are deterministic. Population controls city coverage, while emissive networks remain visible on the night side.'}</p>
              </div>
            </>
          )}
        </aside>
      )}

      <footer className="controls-hint glass-panel">
        <span><i>Drag</i> {view.type === 'universe' || view.type === 'galaxy' ? 'orbit map' : 'orbit camera'}</span>
        <span><i>Wheel</i> zoom</span>
        <span><i>Click</i> inspect</span>
      </footer>
    </main>
  )
}

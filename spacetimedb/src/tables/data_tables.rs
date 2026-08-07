use spacetimedb::{Identity, SpacetimeType, Timestamp};

use crate::types::Vec3;

#[spacetimedb::table(accessor = player)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,

    pub auth_issuer: String,
    pub auth_subject: String,
    pub username: String,
}

#[spacetimedb::table(accessor = game_clock)]
pub struct GameClock {
    #[primary_key]
    pub id: u8,

    pub last_tick: Timestamp,
    pub last_broadcast: Timestamp,
    pub simulation_time_seconds: f64,
    pub time_scale: f32,
}

/// Low-frequency authoritative clock sample replicated to clients.
/// Clients extrapolate between samples instead of receiving per-frame positions.
#[spacetimedb::table(accessor = simulation_clock, public)]
pub struct SimulationClock {
    #[primary_key]
    pub id: u8,

    pub simulation_time_seconds: f64,
    pub time_scale: f32,
    pub revision: u64,
}

#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    pub name: String,
}

#[spacetimedb::table(accessor = galaxy)]
#[derive(Clone)]
pub struct Galaxy {
    #[primary_key]
    pub id: String,

    pub name: String,
    pub position: Vec3,
    pub radius: f32,
    pub thickness: f32,
    pub rotation: f32,
    pub inclination: Option<Vec3>,
    pub morphology: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub description: String,
    pub discovered_by: String,
    pub estimated_systems: String,
    pub seed: f32,
    pub arm_count: Option<u16>,
    pub arm_winding: Option<f32>,
    pub companions: Option<String>,
    pub home: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct Vec3f {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub enum SystemPrimaryKind {
    Star,
    BlackHole,
}

#[derive(SpacetimeType, Clone, Debug)]
pub enum SystemMapRole {
    Standard,
    GalacticCore,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AccretionDisk {
    pub inner_radius: f32,
    pub outer_radius: f32,
    pub thickness: f32,

    pub tilt: Vec3f,

    pub inner_color: String,
    pub outer_color: String,

    pub opacity: f32,
    pub luminosity: f32,
    pub rotation_speed: f32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BlackHole {
    pub mass_solar: u64,
    pub event_horizon_radius: f32,
    pub spin: f32,

    pub photon_ring_color: String,
    pub accretion_disk: Option<AccretionDisk>,

    pub jet_color: String,
    pub jet_length: f32,
    pub jet_intensity: f32,

    pub lensing_strength: f32,
    pub lensing_radius_multiplier: f32,
}


#[spacetimedb::table(accessor = star_system)]
pub struct StarSystem {
    #[primary_key]
    pub id: String,

    #[index(btree)]
    pub galaxy_id: String,

    pub name: String,

    /// Coordinates in the parent galaxy's local space.
    ///
    /// - (0, 0, 0) is the galaxy center.
    /// - x/z use the same units as `Galaxy::radius`.
    /// - y uses the same units as `Galaxy::thickness`.
    /// - the galaxy overview position/rotation are not baked into this value.
    pub position: Vec3f,

    pub primary_kind: SystemPrimaryKind,
    pub map_role: SystemMapRole,

    pub spectral_type: String,
    pub star_color: String,
    pub star_radius: f32,

    /// Primary mass in solar masses. This is the canonical value for both
    /// ordinary stars and black-hole primaries.
    pub primary_mass_solar: f32,

    /// Base territorial reach in galaxy-local map units. It is derived from
    /// primary mass with a sub-linear curve so massive stars matter without
    /// dominating an entire galaxy.
    pub influence_radius: f32,

    /// Dimensionless source strength paired with `influence_radius`.
    pub influence_strength: f32,

    pub black_hole: Option<BlackHole>,

    pub zone_color: Option<String>,
    pub zone_radius: Option<f32>,
    pub zone_strength: Option<f32>,
    pub zone_name: Option<String>,

    /// None means unclaimed.
    pub owner_identity: Option<Identity>,

    pub description: String,
    pub faction: String,

    /// Store the real number rather than "18.4 billion".
    pub population: u64,
}


#[derive(SpacetimeType, Clone, Debug)]
pub struct PlanetTemperature {
    pub pole: i16,
    pub equator: i16,
    pub substellar: i16,
    pub antistellar: i16,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PlanetProduction {
    pub unit: String,
    pub cycle: String,

    pub industry: u64,
    pub energy: u64,
    pub resources: u64,
    pub fuel: u64,
    pub food: u64,
    pub research: u64,
}

#[spacetimedb::table(accessor = planet)]
pub struct Planet {
    #[primary_key]
    pub id: String,

    #[index(btree)]
    pub system_id: String,

    pub name: String,
    pub planet_type: String,

    pub radius: f32,

    /// Semi-major axis in the parent system's local units.
    pub orbit_radius: f32,
    /// Radians per simulation second.
    pub orbit_speed: f32,
    /// Phase at simulation t=0, in radians.
    pub orbit_offset: f32,
    /// All orbital orientation angles are radians.
    pub orbit_inclination: f32,
    pub orbit_eccentricity: f32,
    pub orbit_longitude: f32,
    pub orbit_argument: f32,
    pub orbit_index: u16,

    pub color: String,
    pub secondary_color: Option<String>,

    pub temperature: PlanetTemperature,

    pub population: u64,
    pub colonized: bool,

    pub production: Option<PlanetProduction>,

    pub gravity: f32,
    pub atmosphere: String,

    pub description: String,
    pub discovered_by: String,

    /// Small value collection that is normally read with the planet.
    pub resources: Vec<String>,

    pub axial_tilt: f32,
    pub tidally_locked: bool,

    pub land_fraction: Option<f32>,
    pub ring_color: Option<String>,
}


#[spacetimedb::table(accessor = moon)]
pub struct Moon {
    #[primary_key]
    pub id: String,

    #[index(btree)]
    pub planet_id: String,

    pub name: String,
    pub moon_type: String,

    pub radius: f32,

    /// Semi-major axis in the parent planet's local units.
    pub orbit_radius: f32,
    /// Radians per simulation second.
    pub orbit_speed: f32,
    /// Phase at simulation t=0, in radians.
    pub orbit_offset: f32,
    /// All orbital orientation angles are radians.
    pub orbit_inclination: f32,
    pub orbit_eccentricity: f32,
    pub orbit_longitude: f32,
    pub orbit_argument: f32,

    pub color: String,
    pub secondary_color: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub enum SurfacePointKind {
    Mission,
    Settlement,
    Anomaly,
    Resource,
}

#[derive(SpacetimeType, Clone, Debug)]
pub enum SurfaceVisualType {
    SettlementLand,
    SettlementWater,
    Vault,
}

#[spacetimedb::table(accessor = surface_point)]
pub struct SurfacePoint {
    #[primary_key]
    pub id: String,

    #[index(btree)]
    pub planet_id: String,

    pub label: String,
    pub kind: SurfacePointKind,

    pub latitude: f32,
    pub longitude: f32,

    pub description: String,

    pub visual_type: Option<SurfaceVisualType>,
}
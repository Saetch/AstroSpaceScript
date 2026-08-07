use spacetimedb::{Identity, SpacetimeType, ViewContext};

use crate::tables::data_tables::{
    star_system__view, BlackHole, StarSystem, SystemMapRole, SystemPrimaryKind,
    Vec3f,
};

use super::visibility::{visible_galaxy_ids, visible_system_ids};

#[derive(SpacetimeType, Clone, Debug)]
pub struct VisibleStarSystem {
    pub id: String,
    pub galaxy_id: String,
    pub name: String,
    pub position: Vec3f,
    pub primary_kind: String,
    pub map_role: String,
    pub spectral_type: String,
    pub star_color: String,
    pub star_radius: f32,
    pub primary_mass_solar: f32,
    pub influence_radius: f32,
    pub influence_strength: f32,
    pub black_hole: Option<BlackHole>,
    pub zone_color: Option<String>,
    pub zone_radius: Option<f32>,
    pub zone_strength: Option<f32>,
    pub zone_name: Option<String>,
    pub owner_identity: Option<Identity>,
    pub description: String,
    pub faction: String,
    pub population: u64,
}

impl From<StarSystem> for VisibleStarSystem {
    fn from(system: StarSystem) -> Self {
        let primary_kind = match system.primary_kind {
            SystemPrimaryKind::Star => "star",
            SystemPrimaryKind::BlackHole => "black-hole",
        };

        let map_role = match system.map_role {
            SystemMapRole::Standard => "standard",
            SystemMapRole::GalacticCore => "galactic-core",
        };

        Self {
            id: system.id,
            galaxy_id: system.galaxy_id,
            name: system.name,
            position: system.position,
            primary_kind: primary_kind.to_string(),
            map_role: map_role.to_string(),
            spectral_type: system.spectral_type,
            star_color: system.star_color,
            star_radius: system.star_radius,
            primary_mass_solar: system.primary_mass_solar,
            influence_radius: system.influence_radius,
            influence_strength: system.influence_strength,
            black_hole: system.black_hole,
            zone_color: system.zone_color,
            zone_radius: system.zone_radius,
            zone_strength: system.zone_strength,
            zone_name: system.zone_name,
            owner_identity: system.owner_identity,
            description: system.description,
            faction: system.faction,
            population: system.population,
        }
    }
}

#[spacetimedb::view(
    accessor = visible_systems,
    public,
    primary_key = id
)]
pub fn visible_systems(ctx: &ViewContext) -> Vec<VisibleStarSystem> {
    let sender = ctx.sender();
    let galaxy_ids = visible_galaxy_ids(ctx, &sender);
    let system_ids = visible_system_ids(ctx, &sender, &galaxy_ids);

    system_ids
        .into_iter()
        .filter_map(|system_id| ctx.db.star_system().id().find(system_id))
        .map(VisibleStarSystem::from)
        .collect()
}

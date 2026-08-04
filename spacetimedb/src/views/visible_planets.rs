use spacetimedb::ViewContext;

use crate::tables::data_tables::{planet__view, Planet};

use super::visibility::{
    visible_galaxy_ids, visible_planet_ids, visible_system_ids,
};

#[spacetimedb::view(
    accessor = visible_planets,
    public,
    primary_key = id
)]
pub fn visible_planets(ctx: &ViewContext) -> Vec<Planet> {
    let sender = ctx.sender();
    let galaxy_ids = visible_galaxy_ids(ctx, &sender);
    let system_ids = visible_system_ids(ctx, &sender, &galaxy_ids);
    let planet_ids = visible_planet_ids(ctx, &sender, &system_ids);

    planet_ids
        .into_iter()
        .filter_map(|planet_id| ctx.db.planet().id().find(planet_id))
        .collect()
}

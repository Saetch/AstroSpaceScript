use spacetimedb::ViewContext;

use crate::tables::data_tables::{moon__view, Moon};

use super::visibility::{
    visible_galaxy_ids, visible_planet_ids, visible_system_ids,
};

/// Moons inherit visibility from their parent planet. There is deliberately no
/// separate moon-to-player visibility table.
#[spacetimedb::view(
    accessor = visible_moons,
    public,
    primary_key = id
)]
pub fn visible_moons(ctx: &ViewContext) -> Vec<Moon> {
    let sender = ctx.sender();
    let galaxy_ids = visible_galaxy_ids(ctx, &sender);
    let system_ids = visible_system_ids(ctx, &sender, &galaxy_ids);
    let planet_ids = visible_planet_ids(ctx, &sender, &system_ids);

    let mut moons = Vec::new();

    for planet_id in planet_ids {
        moons.extend(ctx.db.moon().planet_id().filter(planet_id.as_str()));
    }

    moons
}

use spacetimedb::{Identity, ReducerContext, Table};
use crate::tables::data_tables::Person;
use crate::tables::visibility_tables::{galaxy_to_player_visibility, GalaxyToPlayerVisibility};

#[spacetimedb::reducer]
pub fn grant_galaxy_visibility_to(ctx: &ReducerContext, name: Identity, galaxy_id: String) {

    let galaxy_to_player_visibility = GalaxyToPlayerVisibility{
        id: 0,
        galaxy_id,
        player_id: name,
    };
    ctx.db.galaxy_to_player_visibility().insert(galaxy_to_player_visibility);
}
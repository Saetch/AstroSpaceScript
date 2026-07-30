use spacetimedb::{ReducerContext, Table};
use crate::procedural::initial_generation;
use crate::scheduled::close_in::ensure_close_in_loop;
use crate::tables::data_tables::*;
use crate::types::Vec3;

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {

    let galaxies = initial_generation::generate_galaxies();
    for galaxy in galaxies.clone() {
        ctx.db.galaxy().insert(galaxy);


    }
    let star_systems = initial_generation::generate_star_systems(galaxies, vec![1500, 2500]);
    for star_system in star_systems {
        ctx.db.star_system().insert(star_system);
    }


    ensure_close_in_loop(ctx);
}

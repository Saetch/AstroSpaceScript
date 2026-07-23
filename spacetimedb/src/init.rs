use spacetimedb::{ReducerContext, Table};

use crate::scheduled::close_in::ensure_close_in_loop;
use crate::tables::data_tables::*;
use crate::types::Vec3;

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.galaxy().insert(Galaxy {
        id: "perseus-ledger".to_string(),
        name: "The Perseus Ledger".to_string(),
        position: Vec3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
        radius: 128.0,
        thickness: 10.0,
        rotation: -0.18,
        inclination: None,
        morphology: "spiral".to_string(),
        primary_color: "#7f9cff".to_string(),
        secondary_color: "#ffd2a1".to_string(),
        description: "the home galaxy and the origin of all".to_string(),
        discovered_by: "Native astronomy".to_string(),
        estimated_systems: "180-200 billion".to_string(),
        seed: 68_421.0,
        arm_count: None,
        arm_winding: None,
        companions: None,
        home: Some(true),
    });

    ctx.db.galaxy().insert(Galaxy {
        id: "perseus-destroyer".to_string(),
        name: "The Perseus Destroyer".to_string(),
        position: Vec3 {
            x: 600.0,
            y: 10.0,
            z: 200.0,
        },
        radius: 368.0,
        thickness: 40.0,
        rotation: -0.68,
        inclination: None,
        morphology: "spiral".to_string(),
        primary_color: "#2f9cff".to_string(),
        secondary_color: "#ffe211".to_string(),
        description: "the home galaxy and the origin of all".to_string(),
        discovered_by: "Native astronomy".to_string(),
        estimated_systems: "180-200 billion".to_string(),
        seed: 12.0,
        arm_count: None,
        arm_winding: None,
        companions: None,
        home: Some(false),
    });

    ensure_close_in_loop(ctx);
}

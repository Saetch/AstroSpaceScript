use spacetimedb::{Identity, ReducerContext, Table};

use crate::tables::data_tables::*;
use crate::tables::visibility_tables::*;

fn galaxy_visibility_exists(
    ctx: &ReducerContext,
    player_id: &Identity,
    galaxy_id: &str,
) -> bool {
    ctx.db
        .galaxy_to_player_visibility()
        .galaxy_id()
        .filter(galaxy_id)
        .any(|visibility| &visibility.player_id == player_id)
}

fn system_visibility_exists(
    ctx: &ReducerContext,
    player_id: &Identity,
    system_id: &str,
) -> bool {
    ctx.db
        .system_to_player_visibility()
        .star_system_id()
        .filter(system_id)
        .any(|visibility| &visibility.player_id == player_id)
}

fn planet_visibility_exists(
    ctx: &ReducerContext,
    player_id: &Identity,
    planet_id: &str,
) -> bool {
    ctx.db
        .planet_to_player_visibility()
        .planet_id()
        .filter(planet_id)
        .any(|visibility| &visibility.player_id == player_id)
}

/// Grants a player visibility of a galaxy and, for now, everything currently
/// contained by that galaxy.
///
/// Later this can be split into discovery/sensor reducers so systems and
/// planets are revealed independently.
#[spacetimedb::reducer]
pub fn grant_galaxy_visibility_to(
    ctx: &ReducerContext,
    player_id: Identity,
    galaxy_id: String,
) -> Result<(), String> {
    if ctx.db.galaxy().id().find(galaxy_id.clone()).is_none() {
        return Err(format!("Galaxy '{galaxy_id}' does not exist"));
    }

    if !galaxy_visibility_exists(ctx, &player_id, &galaxy_id) {
        ctx.db
            .galaxy_to_player_visibility()
            .insert(GalaxyToPlayerVisibility {
                id: 0,
                galaxy_id: galaxy_id.clone(),
                player_id: player_id.clone(),
            });
    }

    let system_ids: Vec<String> = ctx
        .db
        .star_system()
        .galaxy_id()
        .filter(galaxy_id.as_str())
        .map(|system| system.id)
        .collect();

    for system_id in system_ids {
        if !system_visibility_exists(ctx, &player_id, &system_id) {
            ctx.db
                .system_to_player_visibility()
                .insert(SystemToPlayerVisibility {
                    id: 0,
                    player_id: player_id.clone(),
                    star_system_id: system_id.clone(),
                });
        }

        let planet_ids: Vec<String> = ctx
            .db
            .planet()
            .system_id()
            .filter(system_id.as_str())
            .map(|planet| planet.id)
            .collect();

        for planet_id in planet_ids {
            if !planet_visibility_exists(ctx, &player_id, &planet_id) {
                ctx.db
                    .planet_to_player_visibility()
                    .insert(PlanetToPlayerVisibility {
                        id: 0,
                        player_id: player_id.clone(),
                        planet_id,
                    });
            }
        }
    }

    Ok(())
}

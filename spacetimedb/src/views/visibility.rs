use std::collections::BTreeSet;

use spacetimedb::{Identity, ViewContext};

use crate::tables::data_tables::{planet__view, star_system__view};
use crate::tables::visibility_tables::{
    galaxy_to_player_visibility__view,
    planet_to_player_visibility__view,
    system_to_player_visibility__view,
};

pub(super) fn visible_galaxy_ids(
    ctx: &ViewContext,
    sender: &Identity,
) -> BTreeSet<String> {
    ctx.db
        .galaxy_to_player_visibility()
        .player_id()
        .filter(sender.clone())
        .map(|visibility| visibility.galaxy_id)
        .collect()
}

pub(super) fn visible_system_ids(
    ctx: &ViewContext,
    sender: &Identity,
    galaxy_ids: &BTreeSet<String>,
) -> BTreeSet<String> {
    ctx.db
        .system_to_player_visibility()
        .player_id()
        .filter(sender.clone())
        .filter_map(|visibility| {
            ctx.db
                .star_system()
                .id()
                .find(visibility.star_system_id)
        })
        .filter(|system| galaxy_ids.contains(&system.galaxy_id))
        .map(|system| system.id)
        .collect()
}

pub(super) fn visible_planet_ids(
    ctx: &ViewContext,
    sender: &Identity,
    system_ids: &BTreeSet<String>,
) -> BTreeSet<String> {
    ctx.db
        .planet_to_player_visibility()
        .player_id()
        .filter(sender.clone())
        .filter_map(|visibility| {
            ctx.db
                .planet()
                .id()
                .find(visibility.planet_id)
        })
        .filter(|planet| system_ids.contains(&planet.system_id))
        .map(|planet| planet.id)
        .collect()
}

use spacetimedb::{Query, ViewContext};

use crate::tables::data_tables::{galaxy__query, Galaxy};
use crate::tables::visibility_tables::galaxy_to_player_visibility__query;

#[spacetimedb::view(
    accessor = visible_galaxies,
    public,
    primary_key = id
)]
pub fn visible_galaxies(
    ctx: &ViewContext,
) -> impl Query<Galaxy> {
    let sender = ctx.sender();

    ctx.from.galaxy_to_player_visibility().r#where(|visibility| {
        visibility.player_id.eq(sender)
    }).right_semijoin(ctx.from.galaxy(), |visibility, galaxy| {
        visibility.galaxy_id.eq(galaxy.id)
    }).build()
}

#[spacetimedb::view(
    accessor = visible_galaxies_v2,
    public,
    primary_key = id
)]
pub fn visible_galaxies_v2(
    ctx: &ViewContext,
) -> impl Query<Galaxy> {
    let sender = ctx.sender();

    ctx.from
        .galaxy_to_player_visibility()
        .r#where(|visibility| {
            visibility.player_id.eq(sender)
        })
        .right_semijoin(
            ctx.from.galaxy(),
            |visibility, galaxy| {
                visibility.galaxy_id.eq(galaxy.id)
            },
        )
        .build()
}

#[spacetimedb::view(
    accessor = visible_galaxies_v3,
    public
)]
pub fn visible_galaxies_v3(
    ctx: &ViewContext,
) -> impl Query<Galaxy> {
    let sender = ctx.sender();

    ctx.from
        .galaxy_to_player_visibility()
        .r#where(|visibility| {
            visibility.player_id.eq(sender)
        })
        .right_semijoin(
            ctx.from.galaxy(),
            |visibility, galaxy| {
                visibility.galaxy_id.eq(galaxy.id)
            },
        )
        .build()
}
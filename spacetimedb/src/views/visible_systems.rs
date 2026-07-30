use spacetimedb::{Query, ViewContext};

use crate::tables::data_tables::{star_system__query, StarSystem};
use crate::tables::visibility_tables::system_to_player_visibility__query;

#[spacetimedb::view(
    accessor = visible_systems,
    public,
    primary_key = id
)]
pub fn visible_systems(
    ctx: &ViewContext,
) -> impl Query<StarSystem> {
    let sender = ctx.sender();

    ctx.from.system_to_player_visibility().r#where(|visibility| {
        visibility.player_id.eq(sender)
    }).right_semijoin(ctx.from.star_system(), |visibility, star_system| {
        visibility.star_system_id.eq(star_system.id)
    }).build()
}

#[spacetimedb::view(
    accessor = visible_systems_v2,
    public,
    primary_key = id
)]
pub fn visible_systems_v2(
    ctx: &ViewContext,
) -> impl Query<StarSystem> {
    let sender = ctx.sender();

    ctx.from
        .system_to_player_visibility()
        .r#where(|visibility| {
            visibility.player_id.eq(sender)
        })
        .right_semijoin(
            ctx.from.star_system(),
            |visibility, star_system| {
                visibility.star_system_id.eq(star_system.id)
            },
        )
        .build()
}

#[spacetimedb::view(
    accessor = visible_systems_v3,
    public
)]
pub fn visible_systems_v3(
    ctx: &ViewContext,
) -> impl Query<StarSystem> {
    let sender = ctx.sender();

    ctx.from
        .system_to_player_visibility()
        .r#where(|visibility| {
            visibility.player_id.eq(sender)
        })
        .right_semijoin(
            ctx.from.star_system(),
            |visibility, galaxy| {
                visibility.star_system_id.eq(galaxy.id)
            },
        )
        .build()
}
use std::time::Duration;

use spacetimedb::{ReducerContext, ScheduleAt, Table};

use crate::tables::data_tables::*;

#[spacetimedb::table(
    accessor = close_in_tick,
    scheduled(run_close_in_tick)
)]
pub struct CloseInTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,

    pub scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_close_in_tick(ctx: &ReducerContext, _tick: CloseInTick) {
    let now = ctx.timestamp;

    let Some(mut clock) = ctx.db.game_clock().id().find(0) else {
        ctx.db.game_clock().insert(GameClock {
            id: 0,
            last_tick: now,
        });

        return;
    };

    let delta = now.duration_since(clock.last_tick).unwrap_or_default();
    let delta_seconds = delta.as_secs_f32();

    clock.last_tick = now;
    ctx.db.game_clock().id().update(clock);

    apply_close_in(ctx, delta_seconds);
}

pub(crate) fn ensure_close_in_loop(ctx: &ReducerContext) {
    if ctx.db.game_clock().id().find(0).is_none() {
        ctx.db.game_clock().insert(GameClock {
            id: 0,
            last_tick: ctx.timestamp,
        });
    }

    if ctx.db.close_in_tick().count() == 0 {
        ctx.db.close_in_tick().insert(CloseInTick {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(Duration::from_millis(300).into()),
        });
    }
}

fn apply_close_in(ctx: &ReducerContext, delta_seconds: f32) {
    const X_SPEED: f32 = 1.20;
    const Z_SPEED: f32 = 0.40;

    if let Some(mut galaxy) = ctx
        .db
        .galaxy()
        .id()
        .find(String::from("perseus-destroyer"))
    {
        galaxy.position.x -= X_SPEED * delta_seconds;
        galaxy.position.z -= Z_SPEED * delta_seconds;

        log::info!(
            "delta={:.3}s, position=({}, {})",
            delta_seconds,
            galaxy.position.x,
            galaxy.position.z,
        );

        ctx.db.galaxy().id().update(galaxy);
    }
}

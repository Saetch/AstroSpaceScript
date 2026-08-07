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

const CLOCK_BROADCAST_INTERVAL_SECONDS: f32 = 0.25;

#[spacetimedb::reducer]
pub fn run_close_in_tick(ctx: &ReducerContext, _tick: CloseInTick) -> Result<(), String> {
    if !ctx.sender_auth().is_internal() {
        return Err("run_close_in_tick may only be called by the scheduler".into());
    }

    let now = ctx.timestamp;

    let Some(mut clock) = ctx.db.game_clock().id().find(0) else {
        insert_clocks(ctx);
        return Ok(());
    };

    let delta = now.duration_since(clock.last_tick).unwrap_or_default();
    let delta_seconds = delta.as_secs_f64();
    clock.last_tick = now;
    clock.simulation_time_seconds += delta_seconds * f64::from(clock.time_scale);

    let broadcast_elapsed = now
        .duration_since(clock.last_broadcast)
        .unwrap_or_default()
        .as_secs_f32();

    if broadcast_elapsed >= CLOCK_BROADCAST_INTERVAL_SECONDS {
        clock.last_broadcast = now;
        let next_revision = ctx
            .db
            .simulation_clock()
            .id()
            .find(0)
            .map(|sample| sample.revision.saturating_add(1))
            .unwrap_or(1);

        let sample = SimulationClock {
            id: 0,
            simulation_time_seconds: clock.simulation_time_seconds,
            time_scale: clock.time_scale,
            revision: next_revision,
        };

        if ctx.db.simulation_clock().id().find(0).is_some() {
            ctx.db.simulation_clock().id().update(sample);
        } else {
            ctx.db.simulation_clock().insert(sample);
        }
    }

    ctx.db.game_clock().id().update(clock);
    apply_close_in(ctx, delta.as_secs_f32());

    Ok(())
}

pub(crate) fn ensure_close_in_loop(ctx: &ReducerContext) {
    if ctx.db.game_clock().id().find(0).is_none() {
        insert_clocks(ctx);
    } else if ctx.db.simulation_clock().id().find(0).is_none() {
        let clock = ctx.db.game_clock().id().find(0).expect("clock exists");
        ctx.db.simulation_clock().insert(SimulationClock {
            id: 0,
            simulation_time_seconds: clock.simulation_time_seconds,
            time_scale: clock.time_scale,
            revision: 0,
        });
    }

    if ctx.db.close_in_tick().count() == 0 {
        ctx.db.close_in_tick().insert(CloseInTick {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(Duration::from_millis(15).into()),
        });
    }
}

fn insert_clocks(ctx: &ReducerContext) {
    let clock = GameClock {
        id: 0,
        last_tick: ctx.timestamp,
        last_broadcast: ctx.timestamp,
        simulation_time_seconds: 0.0,
        time_scale: 1.0,
    };
    ctx.db.game_clock().insert(clock);
    ctx.db.simulation_clock().insert(SimulationClock {
        id: 0,
        simulation_time_seconds: 0.0,
        time_scale: 1.0,
        revision: 0,
    });
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

        ctx.db.galaxy().id().update(galaxy);
    }
}

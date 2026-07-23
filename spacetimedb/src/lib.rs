use serde::Deserialize;
use std::time::Duration;

use spacetimedb::{Identity, ProcedureContext, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};
const BETTER_AUTH_ISSUER: &str = "http://localhost:3005/api/auth";
const BETTER_AUTH_CLIENT_ID: &str = "perseus-browser";

#[derive(Debug, Deserialize)]
struct BetterAuthClaims {
    username: Option<String>,
}

#[spacetimedb::table(accessor = player)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,

    pub auth_issuer: String,
    pub auth_subject: String,

    pub username: String,
}

#[spacetimedb::table(accessor = game_clock)]
pub struct GameClock {
    #[primary_key]
    pub id: u8,

    last_tick: Timestamp,
}

#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    name: String,
}

#[spacetimedb::table(accessor = galaxy, public)]
pub struct Galaxy {
    #[primary_key]
    pub id: String,
    name: String,
    position: Vec3,
    radius: f32,
    thickness: f32,
    rotation: f32,
    inclination: Option<Vec3>,
    morphology: String,
    primary_color: String,
    secondary_color: String,
    description: String,
    discovered_by: String,
    estimated_systems: String,
    seed: f32,
    arm_count: Option<u16>,
    arm_winding: Option<f32>,
    companions: Option<String>,
    home: Option<bool>,
}

#[spacetimedb::table(accessor = galaxy_to_player_visibility, public)]
pub struct GalaxyToPlayerVisibility {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    #[index(btree)]
    pub player_id: Identity,

    #[index(btree)]
    pub galaxy_id: String,
}

#[spacetimedb::table(
    accessor = close_in_tick,
    scheduled(run_close_in_tick)
)]
pub struct CloseInTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,

    scheduled_at: ScheduleAt,
}

#[spacetimedb::reducer]
pub fn run_close_in_tick(
    ctx: &ReducerContext,
    _tick: CloseInTick,
) {
    let now = ctx.timestamp;

    let Some(mut clock) =
        ctx.db.game_clock().id().find(0)
    else {
        ctx.db.game_clock().insert(GameClock {
            id: 0,
            last_tick: now,
        });

        return;
    };

    let delta = now
        .duration_since(clock.last_tick)
        .unwrap_or_default();

    let delta_seconds = delta.as_secs_f32();

    clock.last_tick = now;
    ctx.db.game_clock().id().update(clock);

    apply_close_in(ctx, delta_seconds);
}

#[derive(Debug, SpacetimeType)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

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
        seed: 68421.0,
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


fn ensure_close_in_loop(ctx: &ReducerContext) {
    if ctx.db.game_clock().id().find(0).is_none() {
        ctx.db.game_clock().insert(GameClock {
            id: 0,
            last_tick: ctx.timestamp,
        });
    }

    if ctx.db.close_in_tick().count() == 0 {
        ctx.db.close_in_tick().insert(CloseInTick {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(
                Duration::from_millis(3).into(),
            ),
        });
    }
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let Some(jwt) = ctx.sender_auth().jwt() else {
        // Preserve ordinary SpacetimeDB CLI/server-issued connections.
        return Ok(());
    };

    // Non-Better-Auth clients may connect, but do not become players.
    if jwt.issuer() != BETTER_AUTH_ISSUER {
        return Ok(());
    }

    if !jwt
        .audience()
        .iter()
        .any(|aud| aud == BETTER_AUTH_CLIENT_ID)
    {
        return Err("Invalid Better Auth audience".to_string());
    }

    let claims: BetterAuthClaims =
        serde_json::from_slice(jwt.raw_payload().as_bytes())
            .map_err(|error| {
                format!("Invalid Better Auth claims: {error}")
            })?;

    let username = claims
        .username
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Better Auth token does not contain a username".to_string()
        })?;

    let identity = ctx.sender();

    match ctx.db.player().identity().find(identity) {
        Some(mut player) => {
            // Keep the SpacetimeDB profile synchronized if the
            // username changes in Better Auth.
            player.username = username;
            player.auth_issuer = jwt.issuer().to_string();
            player.auth_subject = jwt.subject().to_string();

            ctx.db.player().identity().update(player);
        }

        None => {
            ctx.db.player().insert(Player {
                identity,
                auth_issuer: jwt.issuer().to_string(),
                auth_subject: jwt.subject().to_string(),
                username,
            });
        }
    }

    Ok(())
}


fn require_player_auth(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let jwt = ctx
        .sender_auth()
        .jwt()
        .ok_or_else(|| "Better Auth login required".to_string())?;

    if jwt.issuer() != BETTER_AUTH_ISSUER {
        return Err("Better Auth login required".to_string());
    }

    if !jwt
        .audience()
        .iter()
        .any(|aud| aud == BETTER_AUTH_CLIENT_ID)
    {
        return Err("Invalid Better Auth audience".to_string());
    }

    Ok(())
}



fn apply_close_in(
    ctx: &ReducerContext,
    delta_seconds: f32,
) {
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

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(_ctx: &ReducerContext) {}

#[spacetimedb::reducer]
pub fn add(ctx: &ReducerContext, name: u64) {
    ctx.db.person().insert(Person {
        name: name.to_string(),
    });
}

#[spacetimedb::procedure]
pub fn count(ctx: &mut ProcedureContext) -> u64 {
    ctx.with_tx(|tx| tx.db.person().count())
}

#[spacetimedb::reducer]
pub fn say_hello(ctx: &ReducerContext) {
    for person in ctx.db.person().iter() {
        log::info!("Hello, {}!", person.name);
    }
    log::info!("DEBUG!");
    log::info!("Hello, World!");
}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}

use spacetimedb::{Identity, ProcedureContext, ReducerContext, SpacetimeType, Table};

const BETTER_AUTH_ISSUER: &str = "http://localhost:3005/api/auth";
const BETTER_AUTH_CLIENT_ID: &str = "perseus-browser";

#[spacetimedb::table(accessor = player)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub auth_subject: String,
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
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    let jwt = ctx
        .sender_auth()
        .jwt()
        .ok_or_else(|| "Authentication required".to_string())?;

    if jwt.issuer() != BETTER_AUTH_ISSUER {
        return Err("Invalid authentication issuer".to_string());
    }

    if !jwt
        .audience()
        .iter()
        .any(|audience| audience == BETTER_AUTH_CLIENT_ID)
    {
        return Err("Invalid authentication audience".to_string());
    }

    if ctx.db.player().identity().find(ctx.sender()).is_none() {
        ctx.db.player().insert(Player {
            identity: ctx.sender(),
            auth_subject: jwt.subject().to_string(),
        });
    }

    log::info!(
        "Authenticated player connected: {:?} ({})",
        ctx.sender(),
        jwt.subject()
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn close_in(ctx: &ReducerContext) {
    log::info!("Closing in...");
    ctx.db
        .galaxy()
        .iter()
        .filter(|g| g.id == "perseus-destroyer")
        .for_each(|mut g| {
            g.position.x -= 60.0;
            g.position.z -= 20.0;
            log::info!("Position: {:?}", g.position.x);
            ctx.db.galaxy().id().update(g);
        });
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

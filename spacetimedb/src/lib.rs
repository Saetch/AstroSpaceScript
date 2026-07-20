use std::error::Error;
use spacetimedb::{ProcedureContext, ReducerContext, SpacetimeType, Table};
use serde::Deserialize;

#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    name: String,
}

#[spacetimedb::table(accessor = galaxy, public)]
pub struct Galaxy {
    id: String,
    name: String,
    position: Vec3,
    radius: f32,
    thickness: f32,
    rotation: f32,
    inclanation: Option<Vec3>,
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
    home: Option<bool>
}
#[derive(Debug, SpacetimeType)]
struct Vec3{
    x: f32,
    y: f32,
    z: f32,
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.galaxy().insert(Galaxy {
        id: "perseus-ledger".to_string(),
        name: "The Perseus Ledger".to_string(),
        position: Vec3 {x:0.0, y:0.0, z:0.0},
        radius: 128.0,
        thickness: 10.0,
        rotation: -0.18,
        inclanation: None,
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
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {
    // Called everytime a new client connects
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(_ctx: &ReducerContext) {
    // Called everytime a client disconnects
}

#[spacetimedb::reducer]
pub fn add(ctx: &ReducerContext, name: u64) {
    let name = name.to_string();
    ctx.db.person().insert(Person { name });
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
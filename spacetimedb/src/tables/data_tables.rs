use spacetimedb::{Identity, Timestamp};

use crate::types::Vec3;

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

    pub last_tick: Timestamp,
}

#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    pub name: String,
}

#[spacetimedb::table(accessor = galaxy, public)]
pub struct Galaxy {
    #[primary_key]
    pub id: String,

    pub name: String,
    pub position: Vec3,
    pub radius: f32,
    pub thickness: f32,
    pub rotation: f32,
    pub inclination: Option<Vec3>,
    pub morphology: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub description: String,
    pub discovered_by: String,
    pub estimated_systems: String,
    pub seed: f32,
    pub arm_count: Option<u16>,
    pub arm_winding: Option<f32>,
    pub companions: Option<String>,
    pub home: Option<bool>,
}

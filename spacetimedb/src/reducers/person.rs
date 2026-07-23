use spacetimedb::{ReducerContext, Table};

use crate::tables::data_tables::*;

#[spacetimedb::reducer]
pub fn add(ctx: &ReducerContext, name: u64) {
    ctx.db.person().insert(Person {
        name: name.to_string(),
    });
}

#[spacetimedb::reducer]
pub fn say_hello(ctx: &ReducerContext) {
    for person in ctx.db.person().iter() {
        log::info!("Hello, {}!", person.name);
    }

    log::info!("DEBUG!");
    log::info!("Hello, World!");
}

use spacetimedb::{ProcedureContext, Table};

use crate::tables::data_tables::*;

#[spacetimedb::procedure]
pub fn count(ctx: &mut ProcedureContext) -> u64 {
    ctx.with_tx(|transaction| transaction.db.person().count())
}

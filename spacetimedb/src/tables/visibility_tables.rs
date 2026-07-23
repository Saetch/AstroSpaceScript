//! Persisted discovery and visibility state belongs here later.
//!
//! Examples:
//! - systems discovered by a player
//! - sensor visibility
//! - explored sectors
//! - faction intelligence
//!
//! Computed joins can later live in a separate `views` module instead of
//! being duplicated into materialized tables.

use spacetimedb::Identity;

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

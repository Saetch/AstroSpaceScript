use spacetimedb::{ReducerContext, Table};

use crate::auth::{BetterAuthClaims, BETTER_AUTH_CLIENT_ID, BETTER_AUTH_ISSUER};
use crate::tables::data_tables::*;

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
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
        .any(|audience| audience == BETTER_AUTH_CLIENT_ID)
    {
        return Err("Invalid Better Auth audience".to_string());
    }

    let claims: BetterAuthClaims = serde_json::from_slice(jwt.raw_payload().as_bytes())
        .map_err(|error| format!("Invalid Better Auth claims: {error}"))?;

    let username = claims
        .username
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Better Auth token does not contain a username".to_string())?;

    let identity = ctx.sender();

    match ctx.db.player().identity().find(identity) {
        Some(mut player) => {
            // Keep the SpacetimeDB profile synchronized if the username
            // changes in Better Auth.
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

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(_ctx: &ReducerContext) {}

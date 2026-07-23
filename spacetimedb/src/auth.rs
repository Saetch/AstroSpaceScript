use serde::Deserialize;
use spacetimedb::ReducerContext;

pub(crate) const BETTER_AUTH_ISSUER: &str = "http://localhost:3005/api/auth";
pub(crate) const BETTER_AUTH_CLIENT_ID: &str = "perseus-browser";

#[derive(Debug, Deserialize)]
pub(crate) struct BetterAuthClaims {
    pub(crate) username: Option<String>,
}

pub(crate) fn require_player_auth(ctx: &ReducerContext) -> Result<(), String> {
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
        .any(|audience| audience == BETTER_AUTH_CLIENT_ID)
    {
        return Err("Invalid Better Auth audience".to_string());
    }

    Ok(())
}

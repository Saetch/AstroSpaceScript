import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { toNodeHandler } from "better-auth/node";
import {
  AUTH_DB_PATH,
  AUTH_ORIGIN,
  ISSUER,
  OAUTH_CLIENT_ID,
  WEB_ORIGIN,
  auth,
} from "./auth.js";

const port = Number(new URL(AUTH_ORIGIN).port || 3005);

function ensureBrowserClient(): void {
  const db = new DatabaseSync(AUTH_DB_PATH);
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO oauthClient (
      id, clientId, disabled, skipConsent, enableEndSession, subjectType,
      scopes, createdAt, updatedAt, name, redirectUris,
      tokenEndpointAuthMethod, grantTypes, responseTypes, public, type, requirePKCE
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    OAUTH_CLIENT_ID,
    0,
    1,
    0,
    "public",
    JSON.stringify(["openid", "profile"]),
    now,
    now,
    "Perseus browser game",
    JSON.stringify([`${WEB_ORIGIN}/auth/callback`]),
    "none",
    JSON.stringify(["authorization_code"]),
    JSON.stringify(["code"]),
    1,
    "user-agent-based",
    1,
  );

  db.close();
}

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
ensureBrowserClient();

const app = express();

app.use(
  cors({
    origin: WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Keep this before express.json(). Better Auth reads the request body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/auth-config", (_req, res) => {
  res.json({ issuer: ISSUER, clientId: OAUTH_CLIENT_ID });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, issuer: ISSUER, clientId: OAUTH_CLIENT_ID });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Better Auth: ${AUTH_ORIGIN}`);
  console.log(`OIDC issuer: ${ISSUER}`);
  console.log(`OAuth client: ${OAUTH_CLIENT_ID}`);
});

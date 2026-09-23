import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Identity } from "spacetimedb";
import { SpacetimeDBProvider } from "spacetimedb/react";
import init from "rust-orbits";

import App from "./App";
import { AuthScreen } from "./AuthScreen";
import { AuthTopBar } from "./AuthTopBar";
import {
  authClient,
  clearStoredIdToken,
  finishOidcLogin,
  getPlayerId,
  getPlayerName,
  getStoredIdToken,
} from "./auth";
import { UniverseSpaceTimeBridge } from "./data/UniverseSpaceTimeBridge";
import { DbConnection, ErrorContext } from "./module_bindings";

import "./styles.css";
import "./auth.css";

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? "ws://localhost:3003";
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? "rust-project";

function isAuthenticationConnectionError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`.toLowerCase();

  return [
    "auth",
    "credential",
    "forbidden",
    "issuer",
    "jwt",
    "signature",
    "token",
    "unauthorized",
  ].some((part) => message.includes(part));
}

function returnToLogin(message: string): void {
  clearStoredIdToken();

  const url = new URL(window.location.origin);
  url.searchParams.set("auth_error", message);
  window.location.replace(url);
}

function AuthenticatedGame({ token }: { token: string }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const currentPlayer = useMemo(() => ({
    id: getPlayerId(token),
    name: getPlayerName(token),
  }), [token]);

  const connectionBuilder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(token)
        .onConnect((_conn: DbConnection, identity: Identity) => {
          console.log(
            "Connected with authenticated identity:",
            identity.toHexString(),
          );
        })
        .onDisconnect(() => console.log("Disconnected from SpacetimeDB"))
        .onConnectError((_ctx: ErrorContext, error: Error) => {
          console.error("SpacetimeDB connection failed:", error);

          // auth.sqlite contains the Better Auth users and JWT signing keys.
          // If that database is recreated, an ID token left in localStorage is
          // signed by the old key. SpacetimeDB rejects it before client_connected
          // runs, so no Player row can be inserted. Recover by returning to the
          // login screen instead of leaving the app stuck with the stale token.
          if (isAuthenticationConnectionError(error)) {
            returnToLogin(
              "Your saved login token is no longer valid. Please sign in again.",
            );
          }
        }),
    [token],
  );

  async function logout() {
    setLoggingOut(true);

    try {
      await authClient.signOut();
    } finally {
      clearStoredIdToken();
      window.location.assign("/");
    }
  }

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <div className="auth-app-shell">
        <AuthTopBar
          playerName={currentPlayer.name}
          loggingOut={loggingOut}
          onLogout={logout}
        />

        <main className="auth-game-area">
          <UniverseSpaceTimeBridge />
          <App currentPlayer={currentPlayer} />
        </main>
      </div>
    </SpacetimeDBProvider>
  );
}

async function bootstrap() {
  const query = new URLSearchParams(window.location.search);
  let callbackError = query.get("auth_error") ?? undefined;

  if (window.location.pathname === "/auth/callback") {
    try {
      await finishOidcLogin();
    } catch (cause) {
      callbackError = cause instanceof Error ? cause.message : "Login failed";
    }
    window.history.replaceState({}, "", "/");
  } else if (query.has("auth_error")) {
    window.history.replaceState({}, "", "/");
  }

  const token = getStoredIdToken();
  const root = createRoot(document.getElementById("root")!);

  root.render(
    <StrictMode>
      {token ? (
        <AuthenticatedGame token={token} />
      ) : (
        <AuthScreen initialError={callbackError} />
      )}
    </StrictMode>,
  );
}

void bootstrap();

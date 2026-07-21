import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Identity } from "spacetimedb";
import { SpacetimeDBProvider } from "spacetimedb/react";

import App from "./App";
import { AuthScreen } from "./AuthScreen";
import {
  authClient,
  clearStoredIdToken,
  finishOidcLogin,
  getPlayerName,
  getStoredIdToken,
} from "./auth";
import { UniverseSpaceTimeBridge } from "./data/UniverseSpaceTimeBridge";
import { DbConnection, ErrorContext } from "./module_bindings";

import "./styles.css";
import "./auth.css";

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? "ws://localhost:3003";
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? "rust-project";

function AuthenticatedGame({ token }: { token: string }) {
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
        }),
    [token],
  );

  async function logout() {
    await authClient.signOut();
    clearStoredIdToken();
    window.location.assign("/");
  }

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <div className="auth-userbar">
        <span>{getPlayerName(token)}</span>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
      <UniverseSpaceTimeBridge />
      <App />
    </SpacetimeDBProvider>
  );
}

async function bootstrap() {
  let callbackError: string | undefined;

  if (window.location.pathname === "/auth/callback") {
    try {
      await finishOidcLogin();
    } catch (cause) {
      callbackError = cause instanceof Error ? cause.message : "Login failed";
    }
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

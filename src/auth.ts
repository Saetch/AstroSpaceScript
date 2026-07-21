import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const AUTH_ORIGIN =
  import.meta.env.VITE_BETTER_AUTH_ORIGIN ?? "http://localhost:3005";

const TOKEN_KEY = "perseus.oidc.id_token";
const PKCE_VERIFIER_KEY = "perseus.oidc.pkce_verifier";
const OAUTH_STATE_KEY = "perseus.oidc.state";

export const authClient = createAuthClient({
  baseURL: AUTH_ORIGIN,
  plugins: [usernameClient()],
});

type ProviderConfig = {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
};

type JwtPayload = {
  sub?: string;
  name?: string;
  exp?: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomBase64Url(size = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function fakeEmail(username: string): string {
  const bytes = new TextEncoder().encode(username.trim().toLowerCase());
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex}@players.example`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

async function loadProviderConfig(): Promise<ProviderConfig> {
  const appConfigResponse = await fetch(`${AUTH_ORIGIN}/api/auth-config`, {
    credentials: "include",
  });
  if (!appConfigResponse.ok) throw new Error("Auth server is not reachable");

  const appConfig = (await appConfigResponse.json()) as {
    issuer: string;
    clientId: string;
  };

  const discoveryResponse = await fetch(
    `${appConfig.issuer}/.well-known/openid-configuration`,
  );
  if (!discoveryResponse.ok) throw new Error("OIDC discovery failed");

  const discovery = (await discoveryResponse.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
  };

  if (discovery.issuer !== appConfig.issuer) {
    throw new Error("OIDC issuer mismatch");
  }

  return {
    issuer: discovery.issuer,
    clientId: appConfig.clientId,
    authorizationEndpoint: discovery.authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
  };
}

export async function register(username: string, password: string): Promise<void> {
  const cleanUsername = username.trim();
  const { error } = await authClient.signUp.email({
    email: fakeEmail(cleanUsername),
    name: cleanUsername,
    username: cleanUsername,
    displayUsername: cleanUsername,
    password,
  });

  if (error) throw new Error(errorMessage(error, "Could not create user"));
}

export async function login(username: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.username({
    username: username.trim(),
    password,
  });

  if (error) throw new Error(errorMessage(error, "Login failed"));
}

export async function beginOidcLogin(): Promise<never> {
  const provider = await loadProviderConfig();
  const verifier = randomBase64Url(48);
  const state = randomBase64Url(24);
  const challenge = await sha256Base64Url(verifier);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", `${window.location.origin}/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  window.location.assign(url);
  return new Promise<never>(() => undefined);
}

export async function finishOidcLogin(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error");
  if (oauthError) {
    throw new Error(params.get("error_description") ?? oauthError);
  }

  const code = params.get("code");
  const returnedState = params.get("state");
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  if (!code || !returnedState || returnedState !== expectedState || !verifier) {
    throw new Error("Invalid OAuth callback");
  }

  const provider = await loadProviderConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: provider.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    code,
    code_verifier: verifier,
  });

  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const result = (await response.json()) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !result.id_token) {
    throw new Error(result.error_description ?? result.error ?? "Token exchange failed");
  }

  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  localStorage.setItem(TOKEN_KEY, result.id_token);
  return result.id_token;
}

function decodeJwt(token: string): JwtPayload | undefined {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return undefined;
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return undefined;
  }
}

export function getStoredIdToken(): string | undefined {
  const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
  if (!token) return undefined;

  const payload = decodeJwt(token);
  if (!payload?.exp || payload.exp * 1000 <= Date.now()) {
    localStorage.removeItem(TOKEN_KEY);
    return undefined;
  }

  return token;
}

export function getPlayerName(token: string): string {
  const payload = decodeJwt(token);
  return payload?.name ?? payload?.sub ?? "player";
}

export function getPlayerId(token: string): string | undefined {
  return decodeJwt(token)?.sub;
}

export function clearStoredIdToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

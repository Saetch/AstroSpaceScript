import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

export const AUTH_ORIGIN = process.env.AUTH_ORIGIN ?? "http://localhost:3005";
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
export const AUTH_DB_PATH = process.env.AUTH_DB_PATH ?? "./auth.sqlite";
export const ISSUER = `${AUTH_ORIGIN}/api/auth`;
export const OAUTH_CLIENT_ID = "perseus-browser";

export const auth = betterAuth({
  appName: "Perseus Game",
  baseURL: AUTH_ORIGIN,
  basePath: "/api/auth",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-secret-change-me-1234567890",
  database: new DatabaseSync(AUTH_DB_PATH),
  trustedOrigins: [WEB_ORIGIN],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4,
    requireEmailVerification: false,
  },

  // The OAuth provider owns /oauth2/token. Disable Better Auth's plain JWT route.
  disabledPaths: ["/token"],

  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 24,
      usernameValidator: (value) => /^[a-zA-Z0-9_.-]+$/.test(value),
    }),
    jwt({
      jwks: {
        keyPairConfig: { alg: "ES256" },
      },
    }),
    oauthProvider({
      loginPage: "http://localhost:5173/login",
      consentPage: "http://localhost:5173/consent",

      scopes: ["openid", "profile", "email"],

      customIdTokenClaims: ({ user }) => ({
        username: user.username ?? user.name,
      }),
    }),
  ],
});

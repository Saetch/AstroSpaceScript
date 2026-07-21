import { FormEvent, useState } from "react";
import { beginOidcLogin, login, register } from "./auth";

type Props = { initialError?: string };

export function AuthScreen({ initialError }: Props) {
  const [newUser, setNewUser] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (newUser) await register(username, password);
      else await login(username, password);
      await beginOidcLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>{newUser ? "Create player" : "Sign in"}</h1>

        <label>
          Username
          <input
            autoComplete="username"
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_.-]+"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          Password
          <input
            autoComplete={newUser ? "new-password" : "current-password"}
            minLength={4}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-primary" disabled={busy} type="submit">
          {busy ? "Working…" : newUser ? "Create user" : "Login"}
        </button>

        <button
          className="auth-secondary"
          disabled={busy}
          type="button"
          onClick={() => {
            setNewUser((value) => !value);
            setError("");
          }}
        >
          {newUser ? "Back to login" : "New user"}
        </button>
      </form>
    </main>
  );
}

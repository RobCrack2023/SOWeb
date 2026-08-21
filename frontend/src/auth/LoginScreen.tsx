import { useState, type FormEvent } from "react";
import { login, register, type User } from "../lib/auth";
import styles from "./LoginScreen.module.css";

type Mode = "login" | "register";

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = username.trim();
    if (name.length < 3) {
      setError("El usuario debe tener al menos 3 caracteres.");
      return;
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (isRegister && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const user = isRegister ? await register(name, password) : await login(name, password);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.brand}>
          <span className={styles.logo}>🪟</span>
          <h1 className={styles.title}>SOWeb</h1>
          <p className={styles.subtitle}>
            {isRegister ? "Creá tu cuenta para empezar" : "Iniciá sesión para entrar al escritorio"}
          </p>
        </div>

        <label className={styles.field}>
          <span className={styles.labelText}>Usuario</span>
          <input
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={busy}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.labelText}>Contraseña</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            disabled={busy}
          />
        </label>

        {isRegister && (
          <label className={styles.field}>
            <span className={styles.labelText}>Repetir contraseña</span>
            <input
              className={styles.input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? "Un momento…" : isRegister ? "Crear cuenta" : "Entrar"}
        </button>

        <div className={styles.switch}>
          {isRegister ? (
            <>
              ¿Ya tenés cuenta?{" "}
              <button type="button" className={styles.link} onClick={() => switchMode("login")}>
                Iniciar sesión
              </button>
            </>
          ) : (
            <>
              ¿No tenés cuenta?{" "}
              <button type="button" className={styles.link} onClick={() => switchMode("register")}>
                Registrate
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

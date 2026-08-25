import { useEffect, useState, type FormEvent } from "react";
import { authInfo, login, register, type User } from "../lib/auth";
import styles from "./LoginScreen.module.css";

type Mode = "login" | "register";

/** The same four-pane mark the taskbar's start button uses. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" rx="1.5" />
      <rect x="13" y="2" width="9" height="9" rx="1.5" />
      <rect x="2" y="13" width="9" height="9" rx="1.5" />
      <rect x="13" y="13" width="9" height="9" rx="1.5" />
    </svg>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** What someone signing up actually gets, in their terms. */
const WHAT_YOU_GET = [
  {
    icon: "🗂️",
    title: "Tus archivos, en cualquier equipo",
    body: "Carpetas y documentos que quedan guardados acá. Entrás desde otra máquina y están donde los dejaste.",
  },
  {
    icon: "📄",
    title: "Documentos, planillas y presentaciones",
    body: "Se guardan en Word, Excel y PowerPoint, así que también sirven fuera de SOWeb.",
  },
  {
    icon: "💬",
    title: "Chat con el resto del espacio",
    body: "Conversaciones y grupos, al instante, sin salir del escritorio.",
  },
  {
    icon: "✉️",
    title: "Tu correo de siempre",
    body: "Conectás Gmail, Outlook o el servidor que uses, y lo leés desde acá.",
  },
];

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invite, setInvite] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useClock();

  // A private instance asks for a code; ask the server rather than guessing.
  useEffect(() => {
    authInfo().then((info) => setInviteRequired(info.invite_required));
  }, []);

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
    const mail = email.trim().toLowerCase();
    if (name.length < 3) {
      setError("El usuario debe tener al menos 3 caracteres.");
      return;
    }
    // Misma forma laxa que valida el servidor: acá solo evita el viaje de ida
    // y vuelta por un correo que ni siquiera tiene arroba.
    if (isRegister && !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(mail)) {
      setError("Escribí un correo válido.");
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
    if (isRegister && inviteRequired && !invite.trim()) {
      setError("Necesitás un código de invitación para crear una cuenta.");
      return;
    }

    setBusy(true);
    try {
      const user = isRegister
        ? await register(name, password, mail, invite.trim())
        : await login(name, password);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      {/* The wallpaper: SOWeb's own desktop, out of focus behind the glass. */}
      <div className={styles.wallpaper} aria-hidden="true">
        <span className={`${styles.pane} ${styles.paneA}`} />
        <span className={`${styles.pane} ${styles.paneB}`} />
        <span className={`${styles.pane} ${styles.paneC}`} />
        <span className={styles.grain} />
      </div>

      <div className={styles.clock} aria-hidden="true">
        <div className={styles.time}>
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className={styles.date}>
          {now.toLocaleDateString([], {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>

      <main className={`${styles.card} ${isRegister ? styles.cardWide : ""}`}>
        {isRegister && (
          <section className={styles.about}>
            <h2 className={styles.aboutTitle}>Qué es SOWeb</h2>
            <p className={styles.aboutLead}>
              Un escritorio completo dentro del navegador: ventanas, archivos y programas, sin
              instalar nada.
            </p>
            <ul className={styles.aboutList}>
              {WHAT_YOU_GET.map((item) => (
                <li key={item.title} className={styles.aboutItem}>
                  <span className={styles.aboutIcon}>{item.icon}</span>
                  <span>
                    <strong className={styles.aboutItemTitle}>{item.title}</strong>
                    <span className={styles.aboutItemBody}>{item.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.aboutFoot}>
              Cada cuenta ve solo lo suyo. Nadie más entra a tus archivos.
            </p>
          </section>
        )}

        <form className={styles.panel} onSubmit={handleSubmit}>
          <div className={styles.avatar}>
            <Mark />
          </div>

          <h1 className={styles.wordmark}>
            <span className={styles.wordmarkSo}>SO</span>
            <span className={styles.wordmarkWeb}>Web</span>
          </h1>
          <p className={styles.subtitle}>
            {isRegister ? "Creá tu cuenta para empezar" : "Iniciá sesión para entrar"}
          </p>

          <label className={styles.field}>
            <span className={styles.srOnly}>Usuario</span>
            <input
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuario"
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </label>

          {isRegister && (
            <label className={styles.field}>
              <span className={styles.srOnly}>Correo</span>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Correo"
                autoComplete="email"
                disabled={busy}
              />
            </label>
          )}

          {/* Password carries the submit arrow, the way Windows does it. */}
          <label className={`${styles.field} ${styles.fieldSubmit}`}>
            <span className={styles.srOnly}>Contraseña</span>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              autoComplete={isRegister ? "new-password" : "current-password"}
              disabled={busy}
            />
            {!isRegister && (
              <button
                type="submit"
                className={styles.go}
                disabled={busy}
                title="Entrar"
                aria-label="Entrar"
              >
                {busy ? <span className={styles.spinner} /> : "→"}
              </button>
            )}
          </label>

          {isRegister && (
            <label className={styles.field}>
              <span className={styles.srOnly}>Repetir contraseña</span>
              <input
                className={styles.input}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repetir contraseña"
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
          )}

          {isRegister && inviteRequired && (
            <label className={styles.field}>
              <span className={styles.srOnly}>Código de invitación</span>
              <input
                className={styles.input}
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="Código de invitación"
                autoComplete="off"
                disabled={busy}
              />
            </label>
          )}

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          {isRegister && (
            <button className={styles.submit} type="submit" disabled={busy}>
              {busy ? "Creando la cuenta…" : "Crear cuenta"}
            </button>
          )}

          <div className={styles.switch}>
            {isRegister ? (
              <>
                ¿Ya tenés cuenta?{" "}
                <button type="button" className={styles.link} onClick={() => switchMode("login")}>
                  Entrar
                </button>
              </>
            ) : (
              <>
                ¿No tenés cuenta?{" "}
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => switchMode("register")}
                >
                  Registrate
                </button>
              </>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

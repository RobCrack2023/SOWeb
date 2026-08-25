import { Fragment, useCallback, useEffect, useState } from "react";
import {
  getActivity,
  getOverview,
  getSessions,
  getUserFiles,
  getUsers,
  type AdminActivity,
  type AdminFile,
  type AdminOverview,
  type AdminSession,
  type AdminUser,
} from "../../lib/adminApi";
import styles from "./AdminPanel.module.css";

type Tab = "overview" | "users" | "sessions" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Resumen" },
  { id: "users", label: "Usuarios" },
  { id: "sessions", label: "Conectados" },
  { id: "activity", label: "Actividad" },
];

/** How often the panel refetches, so "quién está conectado" stays current. */
const REFRESH_MS = 15000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Timestamps arrive as naive UTC from the API; mark them so they render local. */
function parseUtc(value: string): Date {
  return new Date(/[Z+]/.test(value) ? value : `${value}Z`);
}

function formatWhen(value: string | null): string {
  if (!value) return "nunca";
  const date = parseUtc(value);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "hace instantes";
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)} h`;
  return date.toLocaleString();
}

const ACTION_LABELS: Record<string, string> = {
  login: "Inició sesión",
  logout: "Cerró sesión",
  "user.register": "Creó su cuenta",
  "app.open": "Abrió",
  "file.create": "Creó archivo",
  "file.save": "Guardó",
  "file.upload": "Subió",
  "file.delete": "Eliminó archivo",
  "file.rename": "Renombró",
  "folder.create": "Creó carpeta",
  "folder.delete": "Eliminó carpeta",
  "chat.send": "Envió un mensaje",
  "chat.group": "Creó el grupo",
};

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [userFiles, setUserFiles] = useState<AdminFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getOverview(), getUsers(), getSessions(), getActivity()])
      .then(([o, u, s, a]) => {
        setOverview(o);
        setUsers(u);
        setSessions(s);
        setActivity(a);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const toggleUserFiles = (userId: number) => {
    if (expanded === userId) {
      setExpanded(null);
      return;
    }
    setExpanded(userId);
    setUserFiles([]);
    getUserFiles(userId).then(setUserFiles).catch((err) => setError(String(err)));
  };

  if (error) return <div className={styles.error}>Error: {error}</div>;

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className={styles.spacer} />
        <button className={styles.refresh} onClick={load} title="Actualizar ahora">
          🔄
        </button>
      </div>

      <div className={styles.body}>
        {tab === "overview" && overview && (
          <div className={styles.cards}>
            <Card label="Usuarios" value={String(overview.users)} />
            <Card label="Conectados ahora" value={String(overview.online)} highlight />
            <Card label="Archivos" value={String(overview.files)} />
            <Card label="Carpetas" value={String(overview.folders)} />
            <Card label="Espacio usado" value={formatSize(overview.storage_bytes)} />
            <Card label="Acciones (24 h)" value={String(overview.actions_today)} />
            <Card label="Conversaciones" value={String(overview.conversations)} />
            <Card label="Mensajes" value={String(overview.messages)} />
          </div>
        )}

        {tab === "users" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Usuario</th>
                <th>Correo</th>
                <th>Rol</th>
                <th className={styles.num}>Archivos</th>
                <th className={styles.num}>Carpetas</th>
                <th className={styles.num}>Espacio</th>
                <th className={styles.num}>Mensajes</th>
                <th>Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr
                    className={styles.clickable}
                    onClick={() => toggleUserFiles(u.id)}
                    title="Ver los archivos de este usuario"
                  >
                    <td>
                      <span className={u.online ? styles.dotOn : styles.dotOff} />
                    </td>
                    <td>{u.username}</td>
                    <td>{u.email ?? "-"}</td>
                    <td>{u.is_admin ? "admin" : "usuario"}</td>
                    <td className={styles.num}>{u.files}</td>
                    <td className={styles.num}>{u.folders}</td>
                    <td className={styles.num}>{formatSize(u.storage_bytes)}</td>
                    <td className={styles.num}>{u.messages_sent}</td>
                    <td>{formatWhen(u.last_seen)}</td>
                  </tr>
                  {expanded === u.id && (
                    <tr>
                      <td colSpan={9} className={styles.nested}>
                        {userFiles.length === 0 ? (
                          <div className={styles.empty}>Sin archivos.</div>
                        ) : (
                          <table className={styles.subtable}>
                            <thead>
                              <tr>
                                <th>Archivo</th>
                                <th>Carpeta</th>
                                <th className={styles.num}>Tamaño</th>
                                <th>Creado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userFiles.map((f) => (
                                <tr key={f.id}>
                                  <td>{f.name}</td>
                                  <td>{f.folder}</td>
                                  <td className={styles.num}>{formatSize(f.size)}</td>
                                  <td>{parseUtc(f.created_at).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className={styles.note}>
                          Solo se muestran datos del archivo. El panel no permite abrir ni
                          descargar contenido de otras cuentas.
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        {tab === "sessions" && (
          <>
            {sessions.length === 0 ? (
              <div className={styles.empty}>No hay sesiones abiertas.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Usuario</th>
                    <th>Estado</th>
                    <th>Sesión iniciada</th>
                    <th>Última actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={`${s.user_id}-${i}`}>
                      <td>
                        <span className={s.online ? styles.dotOn : styles.dotOff} />
                      </td>
                      <td>{s.username}</td>
                      <td>{s.online ? "conectado" : "inactivo"}</td>
                      <td>{parseUtc(s.started_at).toLocaleString()}</td>
                      <td>{formatWhen(s.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className={styles.note}>
              Una sesión desaparece de esta lista cuando el usuario cierra sesión.
            </div>
          </>
        )}

        {tab === "activity" && (
          <>
            {activity.length === 0 ? (
              <div className={styles.empty}>Todavía no hay actividad registrada.</div>
            ) : (
              <ul className={styles.feed}>
                {activity.map((a) => (
                  <li key={a.id} className={styles.feedItem}>
                    <span className={styles.feedWhen}>{formatWhen(a.created_at)}</span>
                    <span className={styles.feedUser}>{a.username}</span>
                    <span className={styles.feedAction}>
                      {ACTION_LABELS[a.action] ?? a.action}
                    </span>
                    {a.detail && <span className={styles.feedDetail}>{a.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`${styles.card} ${highlight ? styles.cardHighlight : ""}`}>
      <div className={styles.cardValue}>{value}</div>
      <div className={styles.cardLabel}>{label}</div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useWindowStore } from "../windows/windowStore";
import { getApp } from "../apps/registry";
import { logout, type User } from "../lib/auth";
import { useChatStore } from "../lib/chatStore";
import { StartMenu } from "./StartMenu";
import styles from "./Taskbar.module.css";

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);
  return now;
}

function StartLogo() {
  return (
    <svg className={styles.startLogo} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" rx="1" />
      <rect x="13" y="2" width="9" height="9" rx="1" />
      <rect x="2" y="13" width="9" height="9" rx="1" />
      <rect x="13" y="13" width="9" height="9" rx="1" />
    </svg>
  );
}

export function Taskbar({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { windows, openApp, focusWindow, minimizeWindow } = useWindowStore();
  const now = useClock();
  const [startOpen, setStartOpen] = useState(false);
  const topZ = windows.length ? Math.max(...windows.map((x) => x.zIndex)) : 0;

  const unread = useChatStore((s) => s.conversations.reduce((sum, c) => sum + c.unread, 0));

  const openChat = () => {
    const app = getApp("chat")!;
    openApp(app.id, { title: app.title, ...app.defaultSize });
  };

  const handleLogout = async () => {
    if (!window.confirm("¿Cerrar sesión?")) return;
    await logout();
    onLogout();
  };

  return (
    <>
      {startOpen && (
        <StartMenu
          user={user}
          onOpenApp={(appId) => {
            const app = getApp(appId);
            if (app)
              openApp(app.id, {
                title: app.title,
                ...app.defaultSize,
                multiInstance: app.multiInstance,
              });
          }}
          onClose={() => setStartOpen(false)}
        />
      )}

      <div className={styles.taskbar}>
        <div className={styles.center}>
          <button
            className={`${styles.startButton} ${startOpen ? styles.startActive : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setStartOpen((v) => !v);
            }}
            title="Inicio"
          >
            <StartLogo />
          </button>

          {windows.map((w) => {
            const app = getApp(w.appId);
            const isFocused = !w.minimized && w.zIndex === topZ;
            return (
              <button
                key={w.id}
                className={`${styles.task} ${isFocused ? styles.taskActive : ""} ${w.minimized ? styles.taskMinimized : ""}`}
                onClick={() => (w.minimized || !isFocused ? focusWindow(w.id) : minimizeWindow(w.id))}
                title={w.title}
              >
                <span className={styles.taskIcon}>{app?.icon}</span>
                <span className={styles.taskLabel}>{w.title}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.tray}>
          <button
            className={`${styles.chatTray} ${unread > 0 ? styles.chatTrayAlert : ""}`}
            onClick={openChat}
            title={unread > 0 ? `${unread} mensaje(s) sin leer` : "waSO"}
          >
            💬
            {unread > 0 && <span className={styles.chatBadge}>{unread > 99 ? "99+" : unread}</span>}
          </button>
          <span className={styles.user} title={`Conectado como ${user.username}`}>
            👤 {user.username}
          </span>
          <button className={styles.logout} onClick={handleLogout} title="Cerrar sesión">
            ⏻
          </button>
        </div>

        <div className={styles.clock}>
          <div className={styles.clockTime}>
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className={styles.clockDate}>
            {now.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" })}
          </div>
        </div>
      </div>
    </>
  );
}

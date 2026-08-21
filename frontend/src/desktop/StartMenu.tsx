import { useEffect, useRef, useState } from "react";
import { appsFor } from "../apps/registry";
import type { User } from "../lib/auth";
import styles from "./StartMenu.module.css";

export function StartMenu({
  user,
  onOpenApp,
  onClose,
}: {
  user: User;
  onOpenApp: (appId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtered = appsFor(user.is_admin).filter((a) =>
    a.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div
      ref={ref}
      className={styles.menu}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>🔍</span>
        <input
          className={styles.search}
          placeholder="Buscar aplicaciones..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className={styles.section}>Anclado</div>
      <div className={styles.pinnedGrid}>
        {filtered.map((app) => (
          <button
            key={app.id}
            className={styles.pinnedApp}
            onClick={() => {
              onOpenApp(app.id);
              onClose();
            }}
          >
            <span className={styles.pinnedIcon}>{app.icon}</span>
            <span className={styles.pinnedName}>{app.title}</span>
          </button>
        ))}
        {filtered.length === 0 && <div className={styles.noResults}>Sin resultados</div>}
      </div>

      <div className={styles.footer}>
        <div className={styles.user}>
          <span className={styles.avatar}>{user.username[0]?.toUpperCase()}</span>
          <span className={styles.userName}>{user.username}</span>
        </div>
        <button
          className={styles.power}
          title="Reiniciar SOWeb"
          onClick={() => {
            if (window.confirm("¿Reiniciar SOWeb?")) window.location.reload();
          }}
        >
          ⏻
        </button>
      </div>
    </div>
  );
}

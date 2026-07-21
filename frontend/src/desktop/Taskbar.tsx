import { useEffect, useState } from "react";
import { useWindowStore } from "../windows/windowStore";
import { getApp } from "../apps/registry";
import styles from "./Taskbar.module.css";

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Taskbar() {
  const { windows, focusWindow, minimizeWindow } = useWindowStore();
  const now = useClock();

  return (
    <div className={styles.taskbar}>
      <button className={styles.startButton}>SOWeb</button>
      <div className={styles.tasks}>
        {windows.map((w) => {
          const app = getApp(w.appId);
          const isFocused = !w.minimized && w.zIndex === Math.max(...windows.map((x) => x.zIndex));
          return (
            <button
              key={w.id}
              className={`${styles.task} ${isFocused ? styles.taskActive : ""}`}
              onClick={() => (w.minimized ? focusWindow(w.id) : minimizeWindow(w.id))}
            >
              <span>{app?.icon}</span>
              <span className={styles.taskLabel}>{w.title}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.clock}>
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

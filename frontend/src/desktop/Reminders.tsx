import { useEffect, useState } from "react";
import { dueEvents, type CalendarEvent } from "../lib/deskApi";
import styles from "./Reminders.module.css";

/** How often to ask the server whether a reminder has come due. */
const POLL_MS = 60000;

const toLocal = (iso: string) => new Date(/[Z+]/.test(iso) ? iso : `${iso}Z`);

/**
 * Watches for calendar reminders and raises a toast for each one.
 *
 * Dismissals are remembered for the session so a reminder that stays due for
 * an hour doesn't reappear every minute.
 */
export function Reminders() {
  const [due, setDue] = useState<CalendarEvent[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    let stop = false;
    const check = () => {
      dueEvents()
        .then((events) => !stop && setDue(events))
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const showing = due.filter((e) => !dismissed.has(e.id));
  if (showing.length === 0) return null;

  return (
    <div className={styles.stack}>
      {showing.map((event) => {
        const at = toLocal(event.starts_at);
        const minutes = Math.round((at.getTime() - Date.now()) / 60000);
        return (
          <div key={event.id} className={styles.toast}>
            <span className={styles.bell}>🔔</span>
            <div className={styles.text}>
              <div className={styles.title}>{event.title}</div>
              <div className={styles.when}>
                {minutes <= 0
                  ? "Empieza ahora"
                  : minutes < 60
                    ? `En ${minutes} min · ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : at.toLocaleString([], {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
              </div>
            </div>
            <button
              className={styles.close}
              onClick={() => setDismissed((prev) => new Set(prev).add(event.id))}
              title="Descartar"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

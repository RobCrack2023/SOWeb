import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type CalendarEvent,
} from "../../lib/deskApi";
import styles from "./CalendarSO.module.css";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: "Sin recordatorio" },
  { value: 0, label: "A la hora" },
  { value: 10, label: "10 minutos antes" },
  { value: 30, label: "30 minutos antes" },
  { value: 60, label: "1 hora antes" },
  { value: 1440, label: "1 día antes" },
];

/** Stored timestamps are naive UTC; render them in the viewer's zone. */
const toLocal = (iso: string) => new Date(/[Z+]/.test(iso) ? iso : `${iso}Z`);

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Monday-first grid covering the month plus the surrounding week days. */
function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

/** A datetime-local value for an event form. */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CalendarSO() {
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // A month either side, so the grid's leading and trailing days are covered.
    const since = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const until = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 1);
    listEvents(since, until)
      .then(setEvents)
      .catch((e) => setError(String(e)));
  }, [cursor]);

  useEffect(() => load(), [load]);

  const days = monthGrid(cursor);
  const today = new Date();
  const eventsOn = (day: Date) => events.filter((e) => sameDay(toLocal(e.starts_at), day));
  const dayEvents = eventsOn(selectedDay);

  const remove = async (event: CalendarEvent) => {
    if (!window.confirm(`¿Eliminar «${event.title}»?`)) return;
    await deleteEvent(event.id);
    load();
  };

  return (
    <div className={styles.app}>
      <div className={styles.calendar}>
        <div className={styles.head}>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            ‹
          </button>
          <span className={styles.monthLabel}>
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </span>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            ›
          </button>
          <button
            className={styles.todayBtn}
            onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDay(now);
            }}
          >
            Hoy
          </button>
        </div>

        <div className={styles.weekdays}>
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div className={styles.grid}>
          {days.map((day) => {
            const outside = day.getMonth() !== cursor.getMonth();
            const count = eventsOn(day).length;
            return (
              <button
                key={day.toISOString()}
                className={`${styles.day} ${outside ? styles.outside : ""} ${
                  sameDay(day, today) ? styles.today : ""
                } ${sameDay(day, selectedDay) ? styles.selected : ""}`}
                onClick={() => setSelectedDay(day)}
                onDoubleClick={() => {
                  setSelectedDay(day);
                  setEditing("new");
                }}
              >
                <span className={styles.dayNum}>{day.getDate()}</span>
                {count > 0 && (
                  <span className={styles.dots}>
                    {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                      <span key={i} className={styles.dot} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <aside className={styles.side}>
        <div className={styles.sideHead}>
          <span className={styles.sideTitle}>
            {selectedDay.getDate()} de {MONTHS[selectedDay.getMonth()]}
          </span>
          <button className={styles.addBtn} onClick={() => setEditing("new")}>
            + Evento
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {dayEvents.length === 0 && <div className={styles.empty}>Nada agendado este día.</div>}

        <ul className={styles.eventList}>
          {dayEvents.map((event) => {
            const at = toLocal(event.starts_at);
            return (
              <li key={event.id} className={styles.event}>
                <div className={styles.eventTop}>
                  <span className={styles.eventTime}>
                    {event.all_day
                      ? "Todo el día"
                      : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {event.remind_minutes != null && <span title="Con recordatorio">🔔</span>}
                </div>
                <div className={styles.eventTitle}>{event.title}</div>
                {event.notes && <div className={styles.eventNotes}>{event.notes}</div>}
                <div className={styles.eventActions}>
                  <button onClick={() => setEditing(event)}>Editar</button>
                  <button className={styles.danger} onClick={() => remove(event)}>
                    Eliminar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      {editing && (
        <EventDialog
          event={editing === "new" ? null : editing}
          day={selectedDay}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function EventDialog({
  event,
  day,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  day: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = event ? toLocal(event.starts_at) : new Date(day.setHours(9, 0, 0, 0));
  const [title, setTitle] = useState(event?.title ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [when, setWhen] = useState(toInputValue(initial));
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [remind, setRemind] = useState<number | null>(event?.remind_minutes ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Ponele un título.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // datetime-local is local time; send UTC so the server stores one zone.
      const payload = {
        title: title.trim(),
        notes,
        starts_at: new Date(when).toISOString().slice(0, 19),
        all_day: allDay,
        remind_minutes: remind,
      };
      if (event) await updateEvent(event.id, payload);
      else await createEvent(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <form className={styles.dialog} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={styles.dialogTitle}>{event ? "Editar evento" : "Nuevo evento"}</h2>

        <input
          className={styles.input}
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <input
          className={styles.input}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Todo el día
        </label>
        <select
          className={styles.input}
          value={remind === null ? "" : String(remind)}
          onChange={(e) => setRemind(e.target.value === "" ? null : Number(e.target.value))}
        >
          {REMINDERS.map((r) => (
            <option key={String(r.value)} value={r.value === null ? "" : String(r.value)}>
              {r.label}
            </option>
          ))}
        </select>
        <textarea
          className={styles.textarea}
          placeholder="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.dialogActions}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

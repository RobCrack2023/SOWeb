import { apiFetch } from "./api";

export interface Note {
  id: number;
  body: string;
  color: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}

export type NoteInput = Omit<Note, "id">;

export interface CalendarEvent {
  id: number;
  title: string;
  notes: string;
  starts_at: string;
  all_day: boolean;
  remind_minutes: number | null;
}

export type EventInput = Omit<CalendarEvent, "id">;

export const NOTE_COLORS = ["amarillo", "rosa", "celeste", "verde", "lila"] as const;

export const listNotes = () => apiFetch<Note[]>("/notes");

export const createNote = (input: NoteInput) =>
  apiFetch<Note>("/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateNote = (id: number, input: NoteInput) =>
  apiFetch<Note>(`/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteNote = (id: number) => apiFetch<void>(`/notes/${id}`, { method: "DELETE" });

export const listEvents = (since?: Date, until?: Date) => {
  const params = new URLSearchParams();
  if (since) params.set("since", since.toISOString().slice(0, 19));
  if (until) params.set("until", until.toISOString().slice(0, 19));
  const query = params.toString();
  return apiFetch<CalendarEvent[]>(`/events${query ? `?${query}` : ""}`);
};

export const dueEvents = () => apiFetch<CalendarEvent[]>("/events/due");

export const createEvent = (input: EventInput) =>
  apiFetch<CalendarEvent>("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateEvent = (id: number, input: EventInput) =>
  apiFetch<CalendarEvent>(`/events/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteEvent = (id: number) => apiFetch<void>(`/events/${id}`, { method: "DELETE" });

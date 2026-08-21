import { API_BASE } from "./config";

export interface User {
  id: number;
  username: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = "soweb.auth.token";

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function getToken(): string | null {
  return token;
}

function setToken(value: string | null): void {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Authorization header for an authenticated request, or nothing when logged out. */
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function submit(path: string, username: string, password: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "No se pudo completar la operación");
  const data = body as LoginResponse;
  setToken(data.token);
  return data.user;
}

export const register = (username: string, password: string) =>
  submit("/register", username, password);

export const login = (username: string, password: string) => submit("/login", username, password);

export async function logout(): Promise<void> {
  // Revoke server-side, but drop the local token regardless of the outcome.
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeaders() });
  } finally {
    setToken(null);
  }
}

/** Resolve the logged-in user from a stored token, or null if it's gone stale. */
export async function fetchMe(): Promise<User | null> {
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
    if (!res.ok) {
      setToken(null);
      return null;
    }
    return (await res.json()) as User;
  } catch {
    return null;
  }
}

/** Called when any API request comes back 401: the token is no longer good. */
export function clearSession(): void {
  setToken(null);
}

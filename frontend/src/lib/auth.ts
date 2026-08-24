import { API_BASE } from "./config";

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
}

interface LoginResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = "soweb.auth.token";

let token: string | null = localStorage.getItem(TOKEN_KEY);
/** Who the token belongs to, so apps can identify the user without prop drilling. */
let currentUser: User | null = null;

export function getToken(): string | null {
  return token;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

function setToken(value: string | null): void {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
  }
}

/** Authorization header for an authenticated request, or nothing when logged out. */
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Whether this server gates registration behind a code. */
export async function authInfo(): Promise<{ invite_required: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/auth/info`);
    if (res.ok) return await res.json();
  } catch {
    /* offline: assume no code and let the attempt report the real error */
  }
  return { invite_required: false };
}

async function submit(
  path: string,
  username: string,
  password: string,
  invite = "",
): Promise<User> {
  const res = await fetch(`${API_BASE}/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, invite }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "No se pudo completar la operación");
  const data = body as LoginResponse;
  setToken(data.token);
  currentUser = data.user;
  return data.user;
}

export const register = (username: string, password: string, invite = "") =>
  submit("/register", username, password, invite);

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
    currentUser = (await res.json()) as User;
    return currentUser;
  } catch {
    return null;
  }
}

/** Change your own password. Other sessions are revoked server-side. */
export async function changePassword(current: string, next: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ current_password: current, new_password: next }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string" ? detail : "No se pudo cambiar la contraseña.",
    );
  }
}

/** Called when any API request comes back 401: the token is no longer good. */
export function clearSession(): void {
  setToken(null);
}

/**
 * Touch the session so the admin panel keeps showing this user as connected
 * while SOWeb is open, even when they're only reading and not making requests.
 */
export function heartbeat(): void {
  if (!token) return;
  fetch(`${API_BASE}/auth/me`, { headers: authHeaders() }).catch(() => {});
}

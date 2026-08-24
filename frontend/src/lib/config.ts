/**
 * Where the API lives.
 *
 * Relative by default, so the app works wherever it's served from — behind a
 * reverse proxy in production, and through Vite's dev proxy locally. Both mean
 * same-origin requests, so no CORS is involved either way.
 *
 * `VITE_API_BASE` overrides it for setups that split the two across hosts.
 */
export const API_BASE = import.meta.env.VITE_API_BASE || "/api";

/**
 * The chat socket's URL, built from the page's own origin so an HTTPS page
 * gets `wss://`. Browsers refuse a plain `ws://` socket from a secure page.
 */
export function websocketUrl(path: string): string {
  if (/^https?:\/\//i.test(API_BASE)) {
    return `${API_BASE.replace(/^http/i, "ws")}${path}`;
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${API_BASE}${path}`;
}

import { useEffect, useState } from "react";
import { Desktop } from "./desktop/Desktop";
import { LoginScreen } from "./auth/LoginScreen";
import { fetchMe, getToken, heartbeat, type User } from "./lib/auth";

/** Well inside the 5-minute window the backend uses to call a session online. */
const HEARTBEAT_MS = 120000;

function App() {
  const [user, setUser] = useState<User | null>(null);
  // Start out checking only if there's a stored token worth validating.
  const [checking, setChecking] = useState(() => getToken() != null);

  // Without this, dropping a file anywhere outside a registered drop zone makes
  // the browser navigate to it, throwing the user out of SOWeb entirely.
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // Resume a previous session so a reload doesn't ask for the password again.
  useEffect(() => {
    if (!checking) return;
    fetchMe()
      .then(setUser)
      .finally(() => setChecking(false));
  }, [checking]);

  // Keep this session marked as connected for as long as SOWeb is open.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(heartbeat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [user]);

  if (checking) return null;
  if (!user) return <LoginScreen onAuthenticated={setUser} />;
  return <Desktop user={user} onLogout={() => setUser(null)} />;
}

export default App;

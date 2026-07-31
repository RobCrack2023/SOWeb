import { useEffect } from "react";
import { Desktop } from "./desktop/Desktop";

function App() {
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

  return <Desktop />;
}

export default App;

/** Ask the user for a file from their real machine. Resolves null if cancelled. */
export function pickLocalFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Fires when the picker is dismissed without choosing anything.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

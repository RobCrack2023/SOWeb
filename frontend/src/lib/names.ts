export function nextFolderName(existingNames: string[], base = "Nueva carpeta"): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/** Append `ext` unless the name already ends with it. */
export function ensureExt(name: string, ext: string, fallback: string): string {
  const trimmed = name.trim() || fallback;
  return trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`;
}

/** Swap whatever extension a name has for `ext` (used when exporting). */
export function withExt(name: string, ext: string): string {
  return `${name.trim().replace(/\.[^.\\/]+$/, "")}${ext}`;
}

export function nextFolderName(existingNames: string[], base = "Nueva carpeta"): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

import { create } from "zustand";

/**
 * Cross-app filesystem change bus. Any app that mutates the filesystem
 * (create/rename/delete/move/save) calls notifyChange(); apps that display
 * filesystem contents (Desktop, File Explorer, folder tree) subscribe to
 * `version` and reload when it changes, so views stay in sync like a real OS.
 */
interface FsStoreState {
  version: number;
  notifyChange: () => void;
}

export const useFsStore = create<FsStoreState>((set) => ({
  version: 0,
  notifyChange: () => set((s) => ({ version: s.version + 1 })),
}));

import { create } from "zustand";
import { reportActivity } from "../lib/adminApi";

export interface WindowInstance {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevBounds?: { x: number; y: number; width: number; height: number };
  props?: Record<string, unknown>;
}

interface OpenOptions {
  title: string;
  width?: number;
  height?: number;
  props?: Record<string, unknown>;
  multiInstance?: boolean;
}

interface WindowStoreState {
  windows: WindowInstance[];
  nextZIndex: number;
  openApp: (appId: string, options: OpenOptions) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveResize: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  setTitle: (id: string, title: string) => void;
}

let counter = 0;
const cascadeOffset = () => (counter % 8) * 24;

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: [],
  nextZIndex: 1,

  openApp: (appId, { title, width = 720, height = 480, props, multiInstance }) => {
    // Every route into an app funnels through here, so this is the one place
    // that has to record app usage.
    reportActivity("app.open", title);

    if (multiInstance) {
      const id = `${appId}-${Date.now()}`;
      const offset = cascadeOffset();
      counter += 1;
      const zIndex = get().nextZIndex;
      set((state) => ({
        windows: [
          ...state.windows,
          { id, appId, title, x: 80 + offset, y: 60 + offset, width, height, zIndex, minimized: false, maximized: false, props },
        ],
        nextZIndex: zIndex + 1,
      }));
      return id;
    }

    const existing = get().windows.find((w) => w.appId === appId && !w.minimized);
    if (existing) {
      if (props) {
        set((state) => ({
          windows: state.windows.map((w) => (w.id === existing.id ? { ...w, props } : w)),
        }));
      }
      get().focusWindow(existing.id);
      return existing.id;
    }
    const minimizedExisting = get().windows.find((w) => w.appId === appId);
    if (minimizedExisting) {
      if (props) {
        set((state) => ({
          windows: state.windows.map((w) => (w.id === minimizedExisting.id ? { ...w, props } : w)),
        }));
      }
      get().restoreWindow(minimizedExisting.id);
      return minimizedExisting.id;
    }

    const id = `${appId}-${Date.now()}`;
    const offset = cascadeOffset();
    counter += 1;
    const zIndex = get().nextZIndex;
    set((state) => ({
      windows: [
        ...state.windows,
        {
          id,
          appId,
          title,
          x: 80 + offset,
          y: 60 + offset,
          width,
          height,
          zIndex,
          minimized: false,
          maximized: false,
          props,
        },
      ],
      nextZIndex: zIndex + 1,
    }));
    return id;
  },

  closeWindow: (id) => {
    set((state) => ({ windows: state.windows.filter((w) => w.id !== id) }));
  },

  focusWindow: (id) => {
    const zIndex = get().nextZIndex;
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, zIndex, minimized: false } : w)),
      nextZIndex: zIndex + 1,
    }));
  },

  moveResize: (id, bounds) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, ...bounds } : w)),
    }));
  },

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    }));
  },

  restoreWindow: (id) => {
    get().focusWindow(id);
  },

  setTitle: (id, title) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    }));
  },

  toggleMaximize: (id) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const prev = w.prevBounds ?? { x: 80, y: 60, width: 720, height: 480 };
          return { ...w, maximized: false, ...prev };
        }
        return {
          ...w,
          maximized: true,
          prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight - 48,
        };
      }),
    }));
  },
}));

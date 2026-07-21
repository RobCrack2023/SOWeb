import type { ComponentType } from "react";
import { FileExplorer } from "./file-explorer/FileExplorer";

export interface AppDefinition {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<any>;
  defaultSize: { width: number; height: number };
}

export const APPS: AppDefinition[] = [
  {
    id: "file-explorer",
    title: "Explorador de archivos",
    icon: "🗂️",
    component: FileExplorer,
    defaultSize: { width: 780, height: 520 },
  },
];

export const getApp = (appId: string) => APPS.find((a) => a.id === appId);

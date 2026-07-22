import type { ComponentType } from "react";
import { FileExplorer } from "./file-explorer/FileExplorer";
import { TextEditor } from "./text-editor/TextEditor";
import { SpreadSheet } from "./spreadsheet/SpreadSheet";

export interface AppDefinition {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<any>;
  defaultSize: { width: number; height: number };
  multiInstance?: boolean;
}

export const APPS: AppDefinition[] = [
  {
    id: "file-explorer",
    title: "Explorador de archivos",
    icon: "🗂️",
    component: FileExplorer,
    defaultSize: { width: 780, height: 520 },
  },
  {
    id: "text-editor",
    title: "writeSO",
    icon: "📝",
    component: TextEditor,
    defaultSize: { width: 820, height: 600 },
    multiInstance: true,
  },
  {
    id: "spreadsheet",
    title: "spreadSO",
    icon: "📊",
    component: SpreadSheet,
    defaultSize: { width: 900, height: 620 },
    multiInstance: true,
  },
];

export const getApp = (appId: string) => APPS.find((a) => a.id === appId);

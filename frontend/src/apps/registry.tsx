import type { ComponentType } from "react";
import { FileExplorer } from "./file-explorer/FileExplorer";
import { TextEditor } from "./text-editor/TextEditor";
import { SpreadSheet } from "./spreadsheet/SpreadSheet";
import { ShowSO } from "./presentation/ShowSO";
import { PdfSO } from "./pdf/PdfSO";
import { AdminPanel } from "./admin/AdminPanel";
import { WaSO } from "./chat/WaSO";
import { MailSO } from "./mail/MailSO";
import { MediaViewer } from "./viewer/MediaViewer";
import { CodeEditor } from "./viewer/CodeEditor";
import { CalendarSO } from "./calendar/CalendarSO";
import { Calculator } from "./calculator/Calculator";

export interface AppDefinition {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<any>;
  defaultSize: { width: number; height: number };
  multiInstance?: boolean;
  /** Hidden from the desktop and start menu for non-admin accounts. */
  adminOnly?: boolean;
  /** Never shown as an icon; only reachable by opening a file with it. */
  hidden?: boolean;
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
  {
    id: "presentation",
    title: "showSO",
    icon: "📽️",
    component: ShowSO,
    defaultSize: { width: 960, height: 660 },
    multiInstance: true,
  },
  {
    id: "pdf",
    title: "pdfSO",
    icon: "📕",
    component: PdfSO,
    defaultSize: { width: 1000, height: 680 },
    multiInstance: true,
  },
  {
    id: "chat",
    title: "waSO",
    icon: "💬",
    component: WaSO,
    defaultSize: { width: 860, height: 600 },
  },
  {
    id: "mail",
    title: "mailSO",
    icon: "✉️",
    component: MailSO,
    defaultSize: { width: 980, height: 640 },
  },
  {
    id: "calendar",
    title: "Calendario",
    icon: "📅",
    component: CalendarSO,
    defaultSize: { width: 780, height: 560 },
  },
  {
    id: "calculator",
    title: "Calculadora",
    icon: "🧮",
    component: Calculator,
    defaultSize: { width: 300, height: 470 },
  },
  {
    id: "code-editor",
    title: "Editor de texto",
    icon: "📃",
    component: CodeEditor,
    defaultSize: { width: 820, height: 600 },
    multiInstance: true,
  },
  {
    // Opened from a file rather than from the desktop, so it stays off the grid.
    id: "viewer",
    title: "Visor",
    icon: "🖼️",
    component: MediaViewer,
    defaultSize: { width: 880, height: 620 },
    multiInstance: true,
    hidden: true,
  },
  {
    id: "admin",
    title: "Administración",
    icon: "🛡️",
    component: AdminPanel,
    defaultSize: { width: 900, height: 620 },
    adminOnly: true,
  },
];

export const getApp = (appId: string) => APPS.find((a) => a.id === appId);

/** The apps this account may see as icons. */
export const appsFor = (isAdmin: boolean) =>
  APPS.filter((a) => !a.hidden && (!a.adminOnly || isAdmin));

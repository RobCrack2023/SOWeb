import { apiFetch, API_BASE } from "./api";
import { authHeaders } from "./auth";

export interface MailAccount {
  id: number;
  label: string;
  email: string;
  protocol: "imap" | "pop3";
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  smtp_username: string;
  created_at: string;
}

export interface MailAccountInput {
  label: string;
  email: string;
  protocol: "imap" | "pop3";
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  password: string;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  smtp_username: string;
  smtp_password: string;
}

export interface MailEnvelope {
  uid: string;
  subject: string;
  from_name: string;
  from_email: string;
  date: string | null;
  seen: boolean;
  has_attachments: boolean;
}

export interface MailAttachment {
  index: number;
  filename: string;
  content_type: string;
  size: number;
  inline: boolean;
}

export interface MailMessage {
  uid: string;
  subject: string;
  from_name: string;
  from_email: string;
  to: string[];
  cc: string[];
  date: string | null;
  text: string;
  html: string;
  message_id: string;
  attachments: MailAttachment[];
}

export const listAccounts = () => apiFetch<MailAccount[]>("/mail/accounts");

export const createAccount = (input: MailAccountInput) =>
  apiFetch<MailAccount>("/mail/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateAccount = (id: number, input: MailAccountInput) =>
  apiFetch<MailAccount>(`/mail/accounts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteAccount = (id: number) =>
  apiFetch<void>(`/mail/accounts/${id}`, { method: "DELETE" });

export const testAccount = (input: MailAccountInput) =>
  apiFetch<void>("/mail/accounts/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const listFolders = (accountId: number) =>
  apiFetch<string[]>(`/mail/accounts/${accountId}/folders`);

export const listMessages = (accountId: number, folder: string, limit: number, offset: number) =>
  apiFetch<{ messages: MailEnvelope[]; total: number }>(
    `/mail/accounts/${accountId}/messages?folder=${encodeURIComponent(folder)}&limit=${limit}&offset=${offset}`,
  );

export const getMessage = (accountId: number, uid: string, folder: string) =>
  apiFetch<MailMessage>(
    `/mail/accounts/${accountId}/messages/${uid}?folder=${encodeURIComponent(folder)}`,
  );

export const deleteMessage = (accountId: number, uid: string, folder: string) =>
  apiFetch<void>(
    `/mail/accounts/${accountId}/messages/${uid}?folder=${encodeURIComponent(folder)}`,
    { method: "DELETE" },
  );

export const setSeen = (accountId: number, uid: string, folder: string, seen: boolean) =>
  apiFetch<void>(
    `/mail/accounts/${accountId}/messages/${uid}/seen?folder=${encodeURIComponent(folder)}&seen=${seen}`,
    { method: "POST" },
  );

export const sendMail = (
  accountId: number,
  payload: { to: string[]; cc: string[]; subject: string; body: string; in_reply_to?: string },
) =>
  apiFetch<void>(`/mail/accounts/${accountId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

/** Attachments need the auth header, so they're fetched and handed over as a blob. */
export async function downloadAttachment(
  accountId: number,
  uid: string,
  folder: string,
  attachment: MailAttachment,
): Promise<void> {
  const url = `${API_BASE}/mail/accounts/${accountId}/messages/${uid}/attachments/${attachment.index}?folder=${encodeURIComponent(folder)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`No se pudo descargar el adjunto (${res.status})`);
  const blobUrl = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = attachment.filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

/** Ready-made settings for the providers people actually use. */
export interface Preset {
  id: string;
  name: string;
  host: string;
  port: number;
  use_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_ssl: boolean;
  note?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "gmail",
    name: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    use_ssl: true,
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_ssl: false,
    note:
      "Gmail no acepta tu contraseña normal. Activá la verificación en 2 pasos y creá una " +
      "«contraseña de aplicación» en la cuenta de Google; además habilitá IMAP en la configuración de Gmail.",
  },
  {
    id: "outlook",
    name: "Outlook / Hotmail",
    host: "outlook.office365.com",
    port: 993,
    use_ssl: true,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_ssl: false,
    note: "Si la cuenta tiene verificación en 2 pasos, necesitás una contraseña de aplicación.",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    host: "imap.mail.yahoo.com",
    port: 993,
    use_ssl: true,
    smtp_host: "smtp.mail.yahoo.com",
    smtp_port: 587,
    smtp_ssl: false,
    note: "Yahoo exige una contraseña de aplicación.",
  },
  {
    id: "custom",
    name: "Otro servidor",
    host: "",
    port: 993,
    use_ssl: true,
    smtp_host: "",
    smtp_port: 587,
    smtp_ssl: false,
  },
];

/**
 * Minimal Gmail REST client. Auth via one of:
 *   GMAIL_ACCESS_TOKEN                         (short-lived, fine for testing)
 *   GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN   (long-lived)
 * Scopes needed: gmail.send and gmail.readonly (or gmail.modify).
 */
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

let token: { value: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string> {
  if (process.env.GMAIL_ACCESS_TOKEN) return process.env.GMAIL_ACCESS_TOKEN;
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error("Gmail: set GMAIL_ACCESS_TOKEN or GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export async function sendRaw(rfc822: string, threadId?: string): Promise<{ id: string; threadId: string }> {
  return call<{ id: string; threadId: string }>("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: base64url(rfc822), ...(threadId ? { threadId } : {}) }),
  });
}

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailMessage["payload"][] };
}

export async function thread(threadId: string): Promise<{ messages: GmailMessage[] }> {
  return call<{ messages: GmailMessage[] }>(
    `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
  );
}

export async function search(q: string, max = 20): Promise<GmailMessage[]> {
  const list = await call<{ messages?: { id: string; threadId: string }[] }>(
    `/messages?q=${encodeURIComponent(q)}&maxResults=${max}`,
  );
  return list.messages ?? [];
}

export async function message(id: string): Promise<GmailMessage> {
  return call<GmailMessage>(`/messages/${id}?format=full`);
}

export function header(m: GmailMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Concatenate all text parts of a message body. */
export function bodyText(m: GmailMessage): string {
  const out: string[] = [];
  const walk = (p: GmailMessage["payload"] | undefined) => {
    if (!p) return;
    if (p.body?.data) out.push(decodeBase64url(p.body.data));
    for (const part of p.parts ?? []) walk(part);
  };
  walk(m.payload);
  return out.join("\n");
}

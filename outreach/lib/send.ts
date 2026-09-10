/**
 * Sending providers. Every provider returns the provider id, thread id and
 * the RFC 5322 Message-ID so follow-ups can thread properly.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DATA_DIR } from "./config.ts";
import type { Config } from "./types.ts";
import * as gmail from "./gmail.ts";

export interface SendRequest {
  to: string;
  subject: string;
  body: string;
  /** Message-ID of the previous email in the thread, for follow-ups. */
  inReplyTo?: string;
  /** Provider thread id (Gmail) when following up. */
  threadId?: string;
}

export interface SendResult {
  providerId: string;
  threadId: string;
  messageId: string;
}

export interface Provider {
  name: string;
  send(req: SendRequest, cfg: Config): Promise<SendResult>;
}

export function newMessageId(fromEmail: string): string {
  const domain = fromEmail.split("@")[1] ?? "localhost";
  return `<${Date.now().toString(36)}.${randomBytes(8).toString("hex")}@${domain}>`;
}

function encodeHeader(s: string): string {
  // RFC 2047 encode only when non-ASCII is present.
  return /[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s;
}

export function buildRfc822(req: SendRequest, cfg: Config, messageId: string): string {
  const from = `${encodeHeader(cfg.sender.name)} <${cfg.sender.email}>`;
  const lines = [
    `From: ${from}`,
    `To: ${req.to}`,
    `Subject: ${encodeHeader(req.subject)}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (req.inReplyTo) {
    lines.push(`In-Reply-To: ${req.inReplyTo}`, `References: ${req.inReplyTo}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n${req.body.replace(/\r?\n/g, "\r\n")}`;
}

const dryRun: Provider = {
  name: "dry-run",
  async send(req, cfg) {
    const messageId = newMessageId(cfg.sender.email || "outreach@localhost");
    const dir = join(DATA_DIR, "outbox");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${req.to.replace(/[^a-z0-9@.]/gi, "_")}.eml`);
    writeFileSync(file, buildRfc822(req, cfg, messageId));
    return { providerId: file, threadId: req.threadId ?? messageId, messageId };
  },
};

const resend: Provider = {
  name: "resend",
  async send(req, cfg) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("Resend: set RESEND_API_KEY");
    const messageId = newMessageId(cfg.sender.email);
    const headers: Record<string, string> = { "Message-ID": messageId };
    if (req.inReplyTo) {
      headers["In-Reply-To"] = req.inReplyTo;
      headers["References"] = req.inReplyTo;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: `${cfg.sender.name} <${cfg.sender.email}>`,
        to: [req.to],
        subject: req.subject,
        text: req.body,
        headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { id: string };
    return { providerId: j.id, threadId: req.threadId ?? messageId, messageId };
  },
};

const gmailProvider: Provider = {
  name: "gmail",
  async send(req, cfg) {
    const messageId = newMessageId(cfg.sender.email);
    const raw = buildRfc822(req, cfg, messageId);
    const res = await gmail.sendRaw(raw, req.threadId);
    return { providerId: res.id, threadId: res.threadId, messageId };
  },
};

export function provider(name: Config["provider"]): Provider {
  switch (name) {
    case "dry-run":
      return dryRun;
    case "resend":
      return resend;
    case "gmail":
      return gmailProvider;
    default:
      throw new Error(`Unknown provider ${String(name)}`);
  }
}

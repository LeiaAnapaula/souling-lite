/**
 * Mailbox verification without sending mail.
 *
 * 1. MX lookup tells us whether the domain receives mail at all.
 * 2. An SMTP conversation up to RCPT TO asks the server whether the
 *    mailbox exists. Many servers answer honestly; "catch-all" servers accept
 *    every address, which we detect by also probing a random one.
 *
 * Port 25 is often blocked on laptops and cloud sandboxes. When it is, the
 * result is "unknown" and the caller falls back to ranking by pattern.
 */
import { promises as dns } from "node:dns";
import net from "node:net";
import { randomBytes } from "node:crypto";

export type VerifyResult = "valid" | "invalid" | "catchall" | "unknown";

export async function mxHosts(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
}

export async function hasMailServer(domain: string): Promise<boolean> {
  if ((await mxHosts(domain)).length > 0) return true;
  try {
    await dns.resolve4(domain);
    return true; // implicit MX (A record) still receives mail in theory
  } catch {
    return false;
  }
}

interface SmtpProbe {
  code: number;
  text: string;
}

/**
 * Talk to one MX host and return the RCPT TO reply code for `email`.
 * Resolves to null when the connection could not be completed.
 */
export async function smtpRcpt(
  host: string,
  email: string,
  heloDomain: string,
  fromEmail: string,
  timeoutMs = 8000,
): Promise<SmtpProbe | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    let buffer = "";
    let stage = 0;
    let settled = false;
    const finish = (v: SmtpProbe | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.write("QUIT\r\n");
      } catch {
        /* ignore */
      }
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("error", () => finish(null));
    socket.on("close", () => {
      clearTimeout(timer);
      finish(null);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Wait for a complete reply line: "250 text" (not "250-more").
      const lines = buffer.split("\r\n");
      const last = lines.filter(Boolean).at(-1) ?? "";
      if (!/^\d{3} /.test(last)) return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (stage === 0) {
        if (code !== 220) return finish({ code, text: last });
        socket.write(`EHLO ${heloDomain}\r\n`);
        stage = 1;
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${fromEmail}>\r\n`);
        stage = 2;
      } else if (stage === 2) {
        if (code >= 400) return finish({ code, text: last });
        socket.write(`RCPT TO:<${email}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        finish({ code, text: last });
      }
    });
  });
}

function interpret(code: number): VerifyResult {
  if (code >= 250 && code < 260) return "valid";
  if (code === 550 || code === 551 || code === 553 || code === 554 || code === 501) return "invalid";
  // 450/451/452 greylisting or temporary failure, 252 "cannot verify"
  return "unknown";
}

/**
 * Verify one address. Uses the first MX host that answers.
 * A random-address probe decides between "valid" and "catchall".
 */
export async function verifyMailbox(
  email: string,
  opts: { heloDomain: string; fromEmail: string; timeoutMs?: number } = {
    heloDomain: "localhost",
    fromEmail: "verify@localhost",
  },
): Promise<VerifyResult> {
  const domain = email.split("@")[1];
  if (!domain) return "invalid";
  const hosts = await mxHosts(domain);
  if (hosts.length === 0) return (await hasMailServer(domain)) ? "unknown" : "invalid";
  for (const host of hosts.slice(0, 2)) {
    const probe = await smtpRcpt(host, email, opts.heloDomain, opts.fromEmail, opts.timeoutMs);
    if (!probe) continue; // try the next MX
    const result = interpret(probe.code);
    if (result !== "valid") return result;
    const random = `${randomBytes(6).toString("hex")}zq@${domain}`;
    const control = await smtpRcpt(host, random, opts.heloDomain, opts.fromEmail, opts.timeoutMs);
    if (control && interpret(control.code) === "valid") return "catchall";
    return "valid";
  }
  return "unknown";
}

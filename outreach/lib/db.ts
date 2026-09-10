import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Candidate, CandidateStatus, Contact, ContactStatus, EmailStatus, OutboundMessage } from "./types.ts";

type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list TEXT NOT NULL DEFAULT '',
  first TEXT NOT NULL DEFAULT '',
  last TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'new',
  site TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  twitter TEXT NOT NULL DEFAULT '',
  github TEXT NOT NULL DEFAULT '',
  booking TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  sequence TEXT NOT NULL DEFAULT '',
  step INTEGER NOT NULL DEFAULT 0,
  next_send_at TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL DEFAULT '',
  last_message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(list, full_name, org)
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'untested',
  UNIQUE(contact_id, email)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list);
`;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function rowToContact(r: Row): Contact {
  return {
    id: num(r.id),
    list: str(r.list),
    first: str(r.first),
    last: str(r.last),
    fullName: str(r.full_name),
    org: str(r.org),
    title: str(r.title),
    domain: str(r.domain),
    email: str(r.email),
    emailStatus: str(r.email_status) as EmailStatus,
    status: str(r.status) as ContactStatus,
    site: str(r.site),
    linkedin: str(r.linkedin),
    twitter: str(r.twitter),
    github: str(r.github),
    booking: str(r.booking),
    notes: str(r.notes),
    hook: str(r.hook),
    sequence: str(r.sequence),
    step: num(r.step),
    nextSendAt: str(r.next_send_at),
    threadId: str(r.thread_id),
    lastMessageId: str(r.last_message_id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function rowToCandidate(r: Row): Candidate {
  return {
    id: num(r.id),
    contactId: num(r.contact_id),
    email: str(r.email),
    source: str(r.source),
    score: num(r.score),
    status: str(r.status) as CandidateStatus,
  };
}

function rowToMessage(r: Row): OutboundMessage {
  return {
    id: num(r.id),
    contactId: num(r.contact_id),
    step: num(r.step),
    toEmail: str(r.to_email),
    subject: str(r.subject),
    body: str(r.body),
    provider: str(r.provider),
    providerId: str(r.provider_id),
    threadId: str(r.thread_id),
    messageId: str(r.message_id),
    sentAt: str(r.sent_at),
  };
}

const CONTACT_COLUMNS: Record<keyof Omit<Contact, "id" | "createdAt" | "updatedAt">, string> = {
  list: "list",
  first: "first",
  last: "last",
  fullName: "full_name",
  org: "org",
  title: "title",
  domain: "domain",
  email: "email",
  emailStatus: "email_status",
  status: "status",
  site: "site",
  linkedin: "linkedin",
  twitter: "twitter",
  github: "github",
  booking: "booking",
  notes: "notes",
  hook: "hook",
  sequence: "sequence",
  step: "step",
  nextSendAt: "next_send_at",
  threadId: "thread_id",
  lastMessageId: "last_message_id",
};

export type ContactInput = Partial<Omit<Contact, "id" | "createdAt" | "updatedAt">> & {
  fullName: string;
  list: string;
};

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  now(): string {
    return new Date().toISOString();
  }

  /** Insert or update by (list, fullName, org). Returns the contact. */
  upsertContact(input: ContactInput): Contact {
    const existing = this.db
      .prepare("SELECT * FROM contacts WHERE list = ? AND full_name = ? AND org = ?")
      .get(input.list, input.fullName, input.org ?? "") as Row | undefined;
    if (existing) {
      const id = num(existing.id);
      // Only fill blanks on re-import, never clobber discovered data.
      const patch: Partial<Contact> = {};
      for (const key of Object.keys(CONTACT_COLUMNS) as (keyof typeof CONTACT_COLUMNS)[]) {
        const incoming = input[key];
        if (incoming === undefined || incoming === "" || incoming === 0) continue;
        if (existing[CONTACT_COLUMNS[key]] === "" || existing[CONTACT_COLUMNS[key]] == null) {
          (patch as Record<string, unknown>)[key] = incoming;
        }
      }
      if (Object.keys(patch).length) this.updateContact(id, patch);
      return this.getContact(id)!;
    }
    const now = this.now();
    const cols: string[] = ["created_at", "updated_at"];
    const vals: (string | number)[] = [now, now];
    for (const key of Object.keys(CONTACT_COLUMNS) as (keyof typeof CONTACT_COLUMNS)[]) {
      const v = input[key];
      if (v === undefined) continue;
      cols.push(CONTACT_COLUMNS[key]);
      vals.push(v as string | number);
    }
    const placeholders = cols.map(() => "?").join(",");
    const res = this.db
      .prepare(`INSERT INTO contacts (${cols.join(",")}) VALUES (${placeholders})`)
      .run(...vals);
    return this.getContact(Number(res.lastInsertRowid))!;
  }

  updateContact(id: number, patch: Partial<Contact>): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number)[] = [this.now()];
    for (const [key, col] of Object.entries(CONTACT_COLUMNS)) {
      const v = (patch as Record<string, unknown>)[key];
      if (v === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(v as string | number);
    }
    vals.push(id);
    this.db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getContact(id: number): Contact | undefined {
    const r = this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToContact(r) : undefined;
  }

  findContactByEmail(email: string): Contact | undefined {
    const r = this.db
      .prepare("SELECT * FROM contacts WHERE lower(email) = lower(?)")
      .get(email) as Row | undefined;
    return r ? rowToContact(r) : undefined;
  }

  listContacts(filter: { list?: string; status?: ContactStatus | ContactStatus[] } = {}): Contact[] {
    const where: string[] = [];
    const vals: string[] = [];
    if (filter.list) {
      where.push("list = ?");
      vals.push(filter.list);
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      where.push(`status IN (${statuses.map(() => "?").join(",")})`);
      vals.push(...statuses);
    }
    const sql = `SELECT * FROM contacts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id`;
    return (this.db.prepare(sql).all(...vals) as Row[]).map(rowToContact);
  }

  lists(): { list: string; count: number }[] {
    return (
      this.db.prepare("SELECT list, COUNT(*) AS count FROM contacts GROUP BY list ORDER BY list").all() as Row[]
    ).map((r) => ({ list: str(r.list), count: num(r.count) }));
  }

  /** Confirmed emails on a domain, used to learn the org's address pattern. */
  knownEmailsForDomain(domain: string): { first: string; last: string; email: string }[] {
    const rows = this.db
      .prepare(
        `SELECT first, last, email FROM contacts
         WHERE lower(domain) = lower(?) AND email != '' AND email_status IN ('found','verified')`,
      )
      .all(domain) as Row[];
    return rows.map((r) => ({ first: str(r.first), last: str(r.last), email: str(r.email) }));
  }

  addCandidate(contactId: number, email: string, source: string, score: number): void {
    this.db
      .prepare(
        `INSERT INTO candidates (contact_id, email, source, score) VALUES (?,?,?,?)
         ON CONFLICT(contact_id, email) DO UPDATE SET score = max(score, excluded.score)`,
      )
      .run(contactId, email.toLowerCase(), source, score);
  }

  candidates(contactId: number): Candidate[] {
    return (
      this.db
        .prepare("SELECT * FROM candidates WHERE contact_id = ? ORDER BY score DESC, id")
        .all(contactId) as Row[]
    ).map(rowToCandidate);
  }

  setCandidateStatus(id: number, status: CandidateStatus): void {
    this.db.prepare("UPDATE candidates SET status = ? WHERE id = ?").run(status, id);
  }

  recordMessage(m: Omit<OutboundMessage, "id">): number {
    const res = this.db
      .prepare(
        `INSERT INTO messages (contact_id, step, to_email, subject, body, provider, provider_id, thread_id, message_id, sent_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        m.contactId,
        m.step,
        m.toEmail,
        m.subject,
        m.body,
        m.provider,
        m.providerId,
        m.threadId,
        m.messageId,
        m.sentAt,
      );
    return Number(res.lastInsertRowid);
  }

  messagesFor(contactId: number): OutboundMessage[] {
    return (
      this.db.prepare("SELECT * FROM messages WHERE contact_id = ? ORDER BY id").all(contactId) as Row[]
    ).map(rowToMessage);
  }

  sentSince(iso: string): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE sent_at >= ?").get(iso) as Row;
    return num(r.c);
  }

  log(contactId: number | null, type: string, detail = ""): void {
    this.db
      .prepare("INSERT INTO events (contact_id, at, type, detail) VALUES (?,?,?,?)")
      .run(contactId, this.now(), type, detail);
  }

  events(contactId: number): { at: string; type: string; detail: string }[] {
    return (
      this.db.prepare("SELECT at, type, detail FROM events WHERE contact_id = ? ORDER BY id").all(contactId) as Row[]
    ).map((r) => ({ at: str(r.at), type: str(r.type), detail: str(r.detail) }));
  }

  suppress(email: string, reason: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO suppressions (email, reason, at) VALUES (?,?,?)")
      .run(email.toLowerCase(), reason, this.now());
  }

  isSuppressed(email: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM suppressions WHERE email = ?").get(email.toLowerCase());
  }

  stats(): Record<string, number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS c FROM contacts GROUP BY status").all() as Row[];
    const out: Record<string, number> = {};
    for (const r of rows) out[str(r.status)] = num(r.c);
    return out;
  }
}

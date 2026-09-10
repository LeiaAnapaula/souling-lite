/**
 * Sequence engine: who gets which email when, and how bounces and replies
 * change that. Pure functions where possible so they are easy to test.
 */
import type { Store } from "./db.ts";
import type { Candidate, Config, Contact, Sequence } from "./types.ts";

const DAY = 86_400_000;

/** Hour (0-23) and weekday (0 = Sunday) of `date` in the configured timezone. */
export function localParts(date: Date, timezone: string): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false, weekday: "short" });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { hour, weekday };
}

export function inSendWindow(date: Date, cfg: Config): boolean {
  const { hour, weekday } = localParts(date, cfg.sendWindow.timezone);
  if (cfg.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  return hour >= cfg.sendWindow.start && hour < cfg.sendWindow.end;
}

/** Earliest time at or after `from` that falls inside the send window. Steps forward by the hour. */
export function nextWindowStart(from: Date, cfg: Config): Date {
  let t = new Date(from.getTime());
  for (let i = 0; i < 24 * 8; i++) {
    if (inSendWindow(t, cfg)) return t;
    t = new Date(Math.floor(t.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  }
  return from;
}

/** Add days with a little jitter so follow-ups do not all land at the same minute. */
export function followUpTime(sentAt: Date, delayDays: number, cfg: Config, jitterMinutes = 90): Date {
  const jitter = Math.floor(Math.random() * jitterMinutes) * 60_000;
  return nextWindowStart(new Date(sentAt.getTime() + delayDays * DAY + jitter), cfg);
}

/**
 * Which address to send to. Order of preference:
 *   found on a public page > SMTP-verified > catch-all / unknown guess by score.
 * Bounced candidates are skipped; a person is given up on after `maxGuessAttempts` bounces.
 */
export function chooseCandidate(candidates: Candidate[], cfg: Config): Candidate | null {
  const bounced = candidates.filter((c) => c.status === "bounced" || c.status === "invalid").length;
  const live = candidates.filter((c) => c.status !== "bounced" && c.status !== "invalid");
  const rank = (c: Candidate): number => {
    if (c.source.startsWith("found:") || c.source === "github" || c.source === "import" || c.source === "research") return 0;
    if (c.status === "valid") return 1;
    if (c.status === "catchall") return 2;
    return 3;
  };
  live.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
  const pick = live[0];
  if (!pick) return null;
  const isGuess = rank(pick) >= 2;
  if (isGuess && cfg.requireVerifiedOrFound) return null;
  if (isGuess && bounced >= cfg.maxGuessAttempts) return null;
  return pick;
}

export function enroll(store: Store, contact: Contact, seq: Sequence, cfg: Config, now = new Date()): Contact {
  const first = nextWindowStart(now, cfg);
  store.updateContact(contact.id, {
    sequence: seq.name,
    step: 0,
    status: "active",
    nextSendAt: first.toISOString(),
  });
  store.log(contact.id, "enrolled", `${seq.name} first send ${first.toISOString()}`);
  return store.getContact(contact.id)!;
}

export function dueContacts(store: Store, now = new Date()): Contact[] {
  const iso = now.toISOString();
  return store
    .listContacts({ status: "active" })
    .filter((c) => c.nextSendAt !== "" && c.nextSendAt <= iso)
    .sort((a, b) => a.nextSendAt.localeCompare(b.nextSendAt));
}

/** After a successful send: advance the step or finish the sequence. */
export function advance(store: Store, contact: Contact, seq: Sequence, cfg: Config, sentAt: Date): void {
  const nextStep = contact.step + 1;
  if (nextStep >= seq.steps.length) {
    store.updateContact(contact.id, { step: nextStep, status: "done", nextSendAt: "" });
    store.log(contact.id, "sequence-complete");
    return;
  }
  const when = followUpTime(sentAt, seq.steps[nextStep].delayDays, cfg);
  store.updateContact(contact.id, { step: nextStep, nextSendAt: when.toISOString() });
}

/** A reply stops everything for that person. */
export function markReplied(store: Store, contact: Contact, detail = ""): void {
  store.updateContact(contact.id, { status: "replied", nextSendAt: "" });
  store.log(contact.id, "replied", detail);
}

export function unsubscribe(store: Store, contact: Contact, detail = ""): void {
  store.updateContact(contact.id, { status: "unsubscribed", nextSendAt: "" });
  if (contact.email) store.suppress(contact.email, "unsubscribed");
  store.log(contact.id, "unsubscribed", detail);
}

/**
 * The address bounced. Mark it, pick the next candidate, and if the bounced
 * message was step N, re-send step N to the new address right away (the person
 * never saw it). No candidate left: give up on the person.
 */
export function handleBounce(store: Store, contact: Contact, cfg: Config, now = new Date()): "retrying" | "exhausted" {
  const cands = store.candidates(contact.id);
  for (const c of cands) if (c.email === contact.email.toLowerCase()) store.setCandidateStatus(c.id, "bounced");
  store.suppress(contact.email, "bounced");
  store.log(contact.id, "bounced", contact.email);
  const next = chooseCandidate(store.candidates(contact.id), cfg);
  if (!next) {
    store.updateContact(contact.id, { status: "bounced", emailStatus: "bounced", nextSendAt: "" });
    return "exhausted";
  }
  // The bounced send did not reach anyone: rewind one step and try the next address.
  const step = Math.max(0, contact.step - 1);
  store.updateContact(contact.id, {
    email: next.email,
    emailStatus: next.status === "valid" ? "verified" : next.source.startsWith("found") ? "found" : "guessed",
    step,
    status: "active",
    threadId: "",
    lastMessageId: "",
    nextSendAt: nextWindowStart(now, cfg).toISOString(),
  });
  return "retrying";
}

/** Detects an opt-out in an inbound reply body. */
export function looksLikeOptOut(text: string): boolean {
  const t = text.toLowerCase().slice(0, 600);
  return /\b(unsubscribe|no thanks|not interested|stop emailing|remove me|take me off|do not contact|don't contact|opt out)\b/.test(t);
}

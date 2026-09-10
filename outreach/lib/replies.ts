/**
 * Inbound handling for the Gmail provider: replies stop the sequence,
 * bounces roll to the next candidate address.
 */
import * as gmail from "./gmail.ts";
import type { Store } from "./db.ts";
import type { Config } from "./types.ts";
import { handleBounce, looksLikeOptOut, markReplied, unsubscribe } from "./sequence.ts";

export interface InboundSummary {
  replied: string[];
  unsubscribed: string[];
  bounced: string[];
  exhausted: string[];
}

export async function checkInbox(store: Store, cfg: Config): Promise<InboundSummary> {
  const summary: InboundSummary = { replied: [], unsubscribed: [], bounced: [], exhausted: [] };
  const active = store.listContacts({ status: ["active", "done"] }).filter((c) => c.threadId);
  const me = cfg.sender.email.toLowerCase();

  // 1. Replies: any message in one of our threads that is not from us.
  for (const contact of active) {
    let t;
    try {
      t = await gmail.thread(contact.threadId);
    } catch {
      continue;
    }
    for (const m of t.messages ?? []) {
      const from = gmail.header(m, "From").toLowerCase();
      if (!from || from.includes(me)) continue;
      if (/mailer-daemon|postmaster/.test(from)) continue; // handled below
      let body = "";
      try {
        body = gmail.bodyText(await gmail.message(m.id));
      } catch {
        /* metadata only is fine */
      }
      if (looksLikeOptOut(body)) {
        unsubscribe(store, contact, `gmail ${m.id}`);
        summary.unsubscribed.push(contact.fullName);
      } else {
        markReplied(store, contact, `gmail ${m.id} from ${from}`);
        summary.replied.push(contact.fullName);
      }
      break;
    }
  }

  // 2. Bounces: delivery failure notices mentioning one of our addresses.
  const bounces = await gmail.search("from:(mailer-daemon OR postmaster) newer_than:10d", 50).catch(() => []);
  const seen = new Set<string>();
  for (const b of bounces) {
    let full;
    try {
      full = await gmail.message(b.id);
    } catch {
      continue;
    }
    const text = gmail.bodyText(full).toLowerCase() + " " + (full.snippet ?? "").toLowerCase();
    for (const contact of store.listContacts({ status: ["active", "done"] })) {
      const email = contact.email.toLowerCase();
      if (!email || seen.has(email) || !text.includes(email)) continue;
      seen.add(email);
      const outcome = handleBounce(store, contact, cfg);
      (outcome === "retrying" ? summary.bounced : summary.exhausted).push(`${contact.fullName} <${email}>`);
    }
  }
  return summary;
}

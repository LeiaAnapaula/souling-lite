#!/usr/bin/env node
/**
 * Outreach CLI. Run with:  npm run outreach -- <command> [options]
 * Every command works on the local SQLite database in outreach/data/.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./lib/db.ts";
import { CONFIG_PATH, DB_PATH, OUTREACH_DIR, loadConfig, loadSequence } from "./lib/config.ts";
import { parseCsv, toCsv } from "./lib/csv.ts";
import { NON_ORG_DOMAINS, domainFromUrl, learnPattern, parseName, permutations } from "./lib/permute.ts";
import { discoverPerson } from "./lib/discover.ts";
import { verifyMailbox } from "./lib/dns.ts";
import { personalHook, researchList } from "./lib/claude.ts";
import { renderStep } from "./lib/render.ts";
import { provider } from "./lib/send.ts";
import { checkInbox } from "./lib/replies.ts";
import {
  advance,
  chooseCandidate,
  dueContacts,
  enroll,
  handleBounce,
  inSendWindow,
  markReplied,
  unsubscribe,
} from "./lib/sequence.ts";
import type { Contact, ContactStatus } from "./lib/types.ts";

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.flags[key] = next;
        i++;
      } else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function selectContacts(store: Store, args: Args, statuses?: ContactStatus[]): Contact[] {
  const id = flag(args, "id");
  if (id) {
    const c = store.getContact(Number(id));
    if (!c) throw new Error(`No contact ${id}`);
    return [c];
  }
  return store.listContacts({ list: flag(args, "list"), status: statuses });
}

function printContact(c: Contact): void {
  const email = c.email ? `${c.email} (${c.emailStatus})` : "no email";
  console.log(`#${c.id} ${c.fullName} | ${c.title}${c.org ? " @ " + c.org : ""} | ${email} | ${c.status}${c.sequence ? ` ${c.sequence}/${c.step}` : ""}${c.booking ? " | booking" : ""}`);
}

const HELP = `outreach <command> [--list name] [--id N]

Setup
  init                          create outreach/config.json from the example
  status                        counts by status, plus lists

Build the list
  research "<who>" --list L     Claude searches the web and adds people (--max 30)
  import file.csv --list L      columns: name, org, title, domain, email, site, linkedin, twitter, github, notes
  export --list L               CSV of a list to stdout

Find addresses
  discover [--list L|--id N]    scrape public pages, learn org patterns, generate ranked candidates (--verify to SMTP-check)
  verify [--list L|--id N]      SMTP-check the top candidates for people without a confirmed address
  set-email --id N a@b.com      set an address by hand (marks it found)

Write and send
  hooks [--list L|--id N]       Claude writes a one-line personal opener from the notes
  preview --id N [--sequence default]   render every step for one person
  enroll --list L [--sequence default]  put everyone with an address into the sequence
  run [--limit N] [--force-window]      check replies, then send everything due (respects caps and hours)
  check-replies                 Gmail only: stop sequences on reply, roll bounces to the next address

Manage
  show --id N                   full record, candidates, messages, events
  mark-replied --id N | mark-bounced --id N | pause --id N | resume --id N
  unsubscribe a@b.com           never email this address again
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "help" || args.flags.help) {
    console.log(HELP);
    return;
  }
  if (cmd === "init") {
    if (existsSync(CONFIG_PATH)) console.log(`config exists: ${CONFIG_PATH}`);
    else {
      copyFileSync(join(OUTREACH_DIR, "config.example.json"), CONFIG_PATH);
      console.log(`wrote ${CONFIG_PATH}. Edit sender.email, sender.about and sender.booking, then set provider.`);
    }
    return;
  }

  const cfg = loadConfig();
  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "status": {
        console.log(`db: ${DB_PATH}\nprovider: ${cfg.provider}\n`);
        console.table(store.stats());
        console.table(store.lists());
        const due = dueContacts(store);
        console.log(`${due.length} due now; send window open: ${inSendWindow(new Date(), cfg)}`);
        break;
      }

      case "research": {
        const description = args._[1];
        const list = flag(args, "list");
        if (!description || !list) throw new Error('usage: research "<who>" --list <name>');
        const max = Number(flag(args, "max") ?? 30);
        const people = await researchList(description, {
          model: cfg.model,
          maxPeople: max,
          onProgress: (s) => console.log(`  ${s}`),
        });
        let added = 0;
        for (const p of people) {
          const name = parseName(p.full_name);
          const domain = domainFromUrl(p.domain || "");
          const c = store.upsertContact({
            list,
            fullName: p.full_name.trim(),
            first: name.first,
            last: name.last,
            org: p.org.trim(),
            title: p.title.trim(),
            domain,
            site: p.site,
            linkedin: p.linkedin,
            twitter: p.twitter,
            github: p.github,
            booking: p.booking,
            notes: [p.notes, p.gatekeeper ? `Gatekeeper: ${p.gatekeeper}` : "", p.source_urls.length ? `Sources: ${p.source_urls.join(" ")}` : ""]
              .filter(Boolean)
              .join("\n"),
          });
          if (p.known_email && p.known_email.includes("@")) {
            store.addCandidate(c.id, p.known_email, "research", 0.9);
            if (!c.email) store.updateContact(c.id, { email: p.known_email.toLowerCase(), emailStatus: "found", status: "ready" });
          }
          added++;
          printContact(store.getContact(c.id)!);
        }
        console.log(`\n${added} people in list "${list}". Next: discover --list ${list}`);
        break;
      }

      case "import": {
        const file = args._[1];
        const list = flag(args, "list");
        if (!file || !list) throw new Error("usage: import file.csv --list <name>");
        const rows = parseCsv(readFileSync(file, "utf8"));
        let n = 0;
        for (const r of rows) {
          const fullName = r.name || r.full_name || `${r.first ?? ""} ${r.last ?? ""}`.trim();
          if (!fullName) continue;
          const name = parseName(fullName);
          const domain = domainFromUrl(r.domain || r.website || r.company_domain || "");
          const c = store.upsertContact({
            list,
            fullName,
            first: name.first,
            last: name.last,
            org: r.org || r.company || r.organization || "",
            title: r.title || r.role || "",
            domain,
            site: r.site || r.personal_site || "",
            linkedin: r.linkedin || "",
            twitter: r.twitter || r.x || "",
            github: r.github || "",
            booking: r.booking || r.calendly || "",
            notes: r.notes || "",
          });
          if (r.email && r.email.includes("@")) {
            store.addCandidate(c.id, r.email, "import", 1);
            store.updateContact(c.id, { email: r.email.toLowerCase(), emailStatus: "found", status: c.status === "new" ? "ready" : c.status });
          }
          n++;
        }
        console.log(`imported ${n} rows into "${list}"`);
        break;
      }

      case "export": {
        const contacts = selectContacts(store, args);
        const cols = ["id", "fullName", "org", "title", "domain", "email", "emailStatus", "status", "site", "linkedin", "twitter", "booking", "sequence", "step", "nextSendAt"];
        console.log(toCsv(contacts as unknown as Record<string, unknown>[], cols));
        break;
      }

      case "discover": {
        const contacts = selectContacts(store, args).filter((c) => flag(args, "id") || c.status === "new" || c.status === "discovered");
        const verify = !!args.flags.verify;
        for (const c of contacts) {
          console.log(`\n${c.fullName}${c.org ? " @ " + c.org : ""}`);
          const siteIsGithub = /github\.com\//.test(c.site);
          const found = await discoverPerson({
            first: c.first,
            last: c.last,
            site: c.site && !siteIsGithub ? c.site : undefined,
            domain: c.domain || undefined,
            github: c.github || (siteIsGithub ? c.site : undefined),
          });
          const patch: Partial<Contact> = { status: "discovered" };
          if (!c.linkedin && found.links.linkedin) patch.linkedin = found.links.linkedin;
          if (!c.twitter && found.links.twitter) patch.twitter = found.links.twitter;
          if (!c.github && found.links.github) patch.github = found.links.github;
          if (!c.site && found.links.site) patch.site = found.links.site;
          if (!c.booking && found.booking[0]) {
            patch.booking = found.booking[0];
            console.log(`  booking link: ${found.booking[0]}`);
          }
          for (const e of found.emails) {
            store.addCandidate(c.id, e.email, `found:${e.url}`, 1);
            console.log(`  found ${e.email}  (${e.url})`);
          }
          // Domain to permute on: org domain, else the personal site if it is not a free-mail host.
          let domain = c.domain;
          if (!domain && (c.site || found.links.site)) {
            const d = domainFromUrl(c.site || found.links.site);
            if (d && !NON_ORG_DOMAINS.has(d)) domain = d;
          }
          if (domain) {
            if (!c.domain) patch.domain = domain;
            const learned = learnPattern(store.knownEmailsForDomain(domain));
            const perms = permutations({ first: c.first, last: c.last, middle: "" }, domain, learned);
            for (const p of perms) store.addCandidate(c.id, p.email, `pattern:${p.pattern}`, p.score);
            console.log(`  ${perms.length} pattern candidates on ${domain}${learned ? ` (learned ${learned})` : ""}`);
          } else console.log("  no domain to permute on; add one with import or set-email");

          if (verify) await verifyContact(store, c.id, cfg);
          const best = chooseCandidate(store.candidates(c.id), cfg);
          if (best) {
            patch.email = best.email;
            patch.emailStatus = best.source.startsWith("found") || best.source === "github" ? "found" : best.status === "valid" ? "verified" : best.status === "catchall" ? "catchall" : "guessed";
            patch.status = "ready";
            console.log(`  -> ${best.email} [${patch.emailStatus}]`);
          }
          store.updateContact(c.id, patch);
          store.log(c.id, "discovered", `${found.pagesFetched.length} pages, ${found.emails.length} emails`);
        }
        console.log(`\ndiscovered ${contacts.length}. Next: hooks, then enroll.`);
        break;
      }

      case "verify": {
        const contacts = selectContacts(store, args).filter((c) => c.emailStatus !== "found" && c.emailStatus !== "verified");
        for (const c of contacts) {
          console.log(`${c.fullName}`);
          await verifyContact(store, c.id, cfg);
          const best = chooseCandidate(store.candidates(c.id), cfg);
          if (best) {
            store.updateContact(c.id, {
              email: best.email,
              emailStatus: best.status === "valid" ? "verified" : best.status === "catchall" ? "catchall" : "guessed",
              status: c.status === "new" || c.status === "discovered" ? "ready" : c.status,
            });
            console.log(`  -> ${best.email} [${best.status}]`);
          }
        }
        break;
      }

      case "set-email": {
        const id = Number(flag(args, "id"));
        const email = args._[1];
        if (!id || !email?.includes("@")) throw new Error("usage: set-email --id N a@b.com");
        store.addCandidate(id, email, "import", 1);
        store.updateContact(id, { email: email.toLowerCase(), emailStatus: "found", status: "ready" });
        printContact(store.getContact(id)!);
        break;
      }

      case "hooks": {
        const contacts = selectContacts(store, args).filter((c) => flag(args, "id") || (!c.hook && c.notes));
        for (const c of contacts) {
          const hook = await personalHook(c, cfg.sender, cfg.model);
          store.updateContact(c.id, { hook });
          console.log(`${c.fullName}: ${hook || "(no specific hook, template only)"}`);
        }
        break;
      }

      case "preview": {
        const [c] = selectContacts(store, args);
        const seq = loadSequence(flag(args, "sequence") || c.sequence || "default");
        let subject = "";
        seq.steps.forEach((_, i) => {
          const r = renderStep(seq, i, c, cfg, subject);
          if (i === 0) subject = r.subject;
          console.log(`\n===== step ${i} (${i === 0 ? "now" : `+${seq.steps[i].delayDays}d`}) to ${c.email || "<no email>"}\nSubject: ${r.subject}\n\n${r.body}`);
        });
        break;
      }

      case "enroll": {
        const seqName = flag(args, "sequence") ?? "default";
        const seq = loadSequence(seqName);
        const contacts = selectContacts(store, args, ["ready"]).filter((c) => c.email);
        let n = 0;
        for (const c of contacts) {
          if (store.isSuppressed(c.email)) continue;
          if (cfg.requireVerifiedOrFound && !["found", "verified"].includes(c.emailStatus)) continue;
          enroll(store, c, seq, cfg);
          n++;
        }
        console.log(`enrolled ${n} in "${seqName}". Next: run (or schedule it).`);
        break;
      }

      case "check-replies": {
        if (cfg.provider !== "gmail") {
          console.log("check-replies needs provider=gmail. For other providers use mark-replied / mark-bounced.");
          break;
        }
        const s = await checkInbox(store, cfg);
        console.log(JSON.stringify(s, null, 2));
        break;
      }

      case "run": {
        const force = !!args.flags["force-window"];
        if (cfg.provider === "gmail") {
          const s = await checkInbox(store, cfg);
          const total = s.replied.length + s.unsubscribed.length + s.bounced.length + s.exhausted.length;
          if (total) console.log(`inbox: ${JSON.stringify(s)}`);
        }
        if (!force && !inSendWindow(new Date(), cfg)) {
          console.log(`outside send window (${cfg.sendWindow.start}-${cfg.sendWindow.end} ${cfg.sendWindow.timezone}); use --force-window to override`);
          break;
        }
        if (!cfg.sender.email && cfg.provider !== "dry-run") throw new Error("config sender.email is empty");
        const since = new Date(Date.now() - 86_400_000).toISOString();
        const remaining = cfg.dailyCap - store.sentSince(since);
        const limit = Math.min(remaining, Number(flag(args, "limit") ?? remaining));
        if (limit <= 0) {
          console.log(`daily cap reached (${cfg.dailyCap}/24h)`);
          break;
        }
        const due = dueContacts(store).slice(0, limit);
        console.log(`${due.length} to send via ${cfg.provider}`);
        const p = provider(cfg.provider);
        let sent = 0;
        for (const c of due) {
          if (!c.email || store.isSuppressed(c.email)) {
            store.updateContact(c.id, { status: "paused", nextSendAt: "" });
            store.log(c.id, "skipped", "suppressed or missing email");
            continue;
          }
          const seq = loadSequence(c.sequence);
          const prior = store.messagesFor(c.id);
          const threadSubject = prior[0]?.subject ?? "";
          const r = renderStep(seq, c.step, c, cfg, threadSubject);
          try {
            const res = await p.send(
              { to: c.email, subject: r.subject, body: r.body, inReplyTo: c.lastMessageId || undefined, threadId: c.threadId || undefined },
              cfg,
            );
            const sentAt = new Date();
            store.recordMessage({
              contactId: c.id,
              step: c.step,
              toEmail: c.email,
              subject: r.subject,
              body: r.body,
              provider: p.name,
              providerId: res.providerId,
              threadId: res.threadId,
              messageId: res.messageId,
              sentAt: sentAt.toISOString(),
            });
            store.updateContact(c.id, { threadId: res.threadId, lastMessageId: res.messageId });
            advance(store, store.getContact(c.id)!, seq, cfg, sentAt);
            store.log(c.id, "sent", `step ${c.step} to ${c.email}`);
            console.log(`  sent step ${c.step} -> ${c.fullName} <${c.email}>`);
            sent++;
          } catch (err) {
            store.log(c.id, "send-error", String(err));
            console.error(`  FAILED ${c.fullName}: ${String(err)}`);
          }
          if (sent < due.length && cfg.provider !== "dry-run") await sleep(cfg.minSecondsBetweenSends * 1000);
        }
        console.log(`sent ${sent}`);
        break;
      }

      case "show": {
        const [c] = selectContacts(store, args);
        console.log(JSON.stringify(c, null, 2));
        console.log("\ncandidates:");
        console.table(store.candidates(c.id).map(({ email, source, score, status }) => ({ email, source, score, status })));
        console.log("messages:");
        console.table(store.messagesFor(c.id).map(({ step, toEmail, subject, sentAt }) => ({ step, toEmail, subject, sentAt })));
        console.log("events:");
        console.table(store.events(c.id));
        break;
      }

      case "mark-replied": {
        const [c] = selectContacts(store, args);
        markReplied(store, c, "manual");
        printContact(store.getContact(c.id)!);
        break;
      }
      case "mark-bounced": {
        const [c] = selectContacts(store, args);
        console.log(handleBounce(store, c, cfg));
        printContact(store.getContact(c.id)!);
        break;
      }
      case "pause": {
        const [c] = selectContacts(store, args);
        store.updateContact(c.id, { status: "paused" });
        printContact(store.getContact(c.id)!);
        break;
      }
      case "resume": {
        const [c] = selectContacts(store, args);
        store.updateContact(c.id, { status: "active", nextSendAt: c.nextSendAt || new Date().toISOString() });
        printContact(store.getContact(c.id)!);
        break;
      }
      case "unsubscribe": {
        const email = args._[1];
        if (!email) throw new Error("usage: unsubscribe a@b.com");
        store.suppress(email, "manual");
        const c = store.findContactByEmail(email);
        if (c) unsubscribe(store, c, "manual");
        console.log(`suppressed ${email}`);
        break;
      }
      case "list": {
        selectContacts(store, args).forEach(printContact);
        break;
      }
      default:
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

async function verifyContact(store: Store, contactId: number, cfg: ReturnType<typeof loadConfig>): Promise<void> {
  const helo = cfg.sender.email.split("@")[1] || "localhost";
  const from = cfg.sender.email || "verify@localhost";
  const cands = store.candidates(contactId).filter((c) => c.status === "untested").slice(0, 6);
  for (const cand of cands) {
    const result = await verifyMailbox(cand.email, { heloDomain: helo, fromEmail: from });
    store.setCandidateStatus(cand.id, result);
    console.log(`  ${cand.email}: ${result}`);
    if (result === "catchall") {
      // Every address on this domain will say valid; no point probing the rest.
      for (const other of cands) if (other.id !== cand.id) store.setCandidateStatus(other.id, "catchall");
      break;
    }
    if (result === "valid") break;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/db.ts";
import { DEFAULT_CONFIG, type Config, type Sequence } from "../lib/types.ts";
import {
  advance,
  chooseCandidate,
  dueContacts,
  enroll,
  handleBounce,
  inSendWindow,
  looksLikeOptOut,
  markReplied,
  nextWindowStart,
} from "../lib/sequence.ts";
import { renderStep } from "../lib/render.ts";

const cfg: Config = {
  ...DEFAULT_CONFIG,
  sender: { name: "Leia Anapaula", email: "leia@example.com", about: "a student", booking: "https://cal.com/leia" },
  sendWindow: { start: 9, end: 17, timezone: "UTC" },
};
const seq: Sequence = {
  name: "t",
  steps: [
    { delayDays: 0, subject: "hi {{first}}", body: "Hi {{first}},\n\n{{hook}}\n\nfrom {{sender.first}}" },
    { delayDays: 3, body: "bump {{first}}" },
    { delayDays: 7, body: "last {{first}}" },
  ],
};

function fresh() {
  const store = new Store(":memory:");
  const c = store.upsertContact({ list: "l", fullName: "Sara Blakely", first: "sara", last: "blakely", org: "Spanx", domain: "spanx.com" });
  return { store, c };
}

test("send window and next window start (UTC, weekdays)", () => {
  const monday10 = new Date("2026-09-14T10:00:00Z");
  const saturday = new Date("2026-09-12T10:00:00Z");
  const monday20 = new Date("2026-09-14T20:00:00Z");
  assert.equal(inSendWindow(monday10, cfg), true);
  assert.equal(inSendWindow(saturday, cfg), false);
  assert.equal(inSendWindow(monday20, cfg), false);
  assert.equal(nextWindowStart(saturday, cfg).toISOString(), "2026-09-14T09:00:00.000Z");
  assert.equal(nextWindowStart(monday20, cfg).toISOString(), "2026-09-15T09:00:00.000Z");
});

test("chooseCandidate prefers found > verified > guess and respects caps", () => {
  const cands = [
    { id: 1, contactId: 1, email: "sara@spanx.com", source: "pattern:first", score: 0.7, status: "untested" as const },
    { id: 2, contactId: 1, email: "sblakely@spanx.com", source: "pattern:flast", score: 0.6, status: "valid" as const },
    { id: 3, contactId: 1, email: "sara.b@spanx.com", source: "found:https://spanx.com/team", score: 1, status: "untested" as const },
  ];
  assert.equal(chooseCandidate(cands, cfg)?.email, "sara.b@spanx.com");
  assert.equal(chooseCandidate(cands.slice(0, 2), cfg)?.email, "sblakely@spanx.com");
  assert.equal(chooseCandidate(cands.slice(0, 1), cfg)?.email, "sara@spanx.com");
  assert.equal(chooseCandidate(cands.slice(0, 1), { ...cfg, requireVerifiedOrFound: true }), null);
  const bounced = [
    { id: 1, contactId: 1, email: "a@spanx.com", source: "pattern:first", score: 0.7, status: "bounced" as const },
    { id: 2, contactId: 1, email: "b@spanx.com", source: "pattern:flast", score: 0.6, status: "bounced" as const },
    { id: 3, contactId: 1, email: "c@spanx.com", source: "pattern:firstlast", score: 0.5, status: "untested" as const },
  ];
  assert.equal(chooseCandidate(bounced, cfg), null, "two bounces exhaust maxGuessAttempts=2");
  assert.equal(chooseCandidate(bounced, { ...cfg, maxGuessAttempts: 3 })?.email, "c@spanx.com");
});

test("enroll, due, advance, complete", () => {
  const { store, c } = fresh();
  store.updateContact(c.id, { email: "sara@spanx.com", emailStatus: "found", status: "ready" });
  const t0 = new Date("2026-09-14T10:00:00Z");
  const enrolled = enroll(store, store.getContact(c.id)!, seq, cfg, t0);
  assert.equal(enrolled.status, "active");
  assert.equal(enrolled.nextSendAt, t0.toISOString());
  assert.equal(dueContacts(store, new Date("2026-09-14T09:00:00Z")).length, 0);
  assert.equal(dueContacts(store, t0).length, 1);

  advance(store, store.getContact(c.id)!, seq, cfg, t0);
  let after = store.getContact(c.id)!;
  assert.equal(after.step, 1);
  assert.ok(after.nextSendAt >= "2026-09-17T09:00:00.000Z", `follow-up ${after.nextSendAt} is 3+ days out`);
  assert.ok(after.nextSendAt < "2026-09-18T00:00:00.000Z");

  advance(store, after, seq, cfg, new Date(after.nextSendAt));
  after = store.getContact(c.id)!;
  assert.equal(after.step, 2);
  advance(store, after, seq, cfg, new Date(after.nextSendAt));
  after = store.getContact(c.id)!;
  assert.equal(after.status, "done");
  assert.equal(after.nextSendAt, "");
  assert.equal(dueContacts(store, new Date("2027-01-01T12:00:00Z")).length, 0);
});

test("reply stops the sequence", () => {
  const { store, c } = fresh();
  store.updateContact(c.id, { email: "sara@spanx.com", status: "ready" });
  enroll(store, store.getContact(c.id)!, seq, cfg, new Date("2026-09-14T10:00:00Z"));
  markReplied(store, store.getContact(c.id)!);
  assert.equal(store.getContact(c.id)!.status, "replied");
  assert.equal(dueContacts(store, new Date("2027-01-01T12:00:00Z")).length, 0);
});

test("bounce rolls to the next candidate, rewinds the step, then gives up", () => {
  const { store, c } = fresh();
  store.addCandidate(c.id, "sara@spanx.com", "pattern:first", 0.7);
  store.addCandidate(c.id, "sara.blakely@spanx.com", "pattern:first.last", 0.65);
  store.addCandidate(c.id, "sblakely@spanx.com", "pattern:flast", 0.6);
  store.updateContact(c.id, { email: "sara@spanx.com", emailStatus: "guessed", status: "ready" });
  enroll(store, store.getContact(c.id)!, seq, cfg, new Date("2026-09-14T10:00:00Z"));
  advance(store, store.getContact(c.id)!, seq, cfg, new Date("2026-09-14T10:00:00Z")); // step 0 sent
  store.updateContact(c.id, { threadId: "t1", lastMessageId: "<m1>" });

  assert.equal(handleBounce(store, store.getContact(c.id)!, cfg, new Date("2026-09-14T11:00:00Z")), "retrying");
  let after = store.getContact(c.id)!;
  assert.equal(after.email, "sara.blakely@spanx.com");
  assert.equal(after.step, 0, "the bounced first email is re-sent to the new address");
  assert.equal(after.threadId, "", "new address starts a new thread");
  assert.equal(store.isSuppressed("sara@spanx.com"), true);

  assert.equal(handleBounce(store, after, cfg, new Date("2026-09-14T12:00:00Z")), "exhausted", "second bounce hits maxGuessAttempts");
  after = store.getContact(c.id)!;
  assert.equal(after.status, "bounced");
});

test("renderStep fills variables, drops empty hook line, threads follow-ups", () => {
  const { store, c } = fresh();
  const contact = store.getContact(c.id)!;
  const first = renderStep(seq, 0, contact, cfg, "");
  assert.equal(first.subject, "hi Sara");
  assert.ok(first.body.startsWith("Hi Sara,\n\nfrom Leia"), first.body);
  assert.ok(first.body.includes(cfg.optOutLine));
  const second = renderStep(seq, 1, contact, cfg, first.subject);
  assert.equal(second.subject, "Re: hi Sara");
  store.updateContact(c.id, { hook: "Loved the note about the fax machine." });
  const withHook = renderStep(seq, 0, store.getContact(c.id)!, cfg, "");
  assert.ok(withHook.body.includes("Hi Sara,\n\nLoved the note about the fax machine.\n\nfrom Leia"));
});

test("looksLikeOptOut", () => {
  assert.equal(looksLikeOptOut("No thanks, please remove me"), true);
  assert.equal(looksLikeOptOut("Sure, let's talk Tuesday"), false);
});

test("upsert never clobbers discovered data and learns domain patterns", () => {
  const { store, c } = fresh();
  store.updateContact(c.id, { email: "sblakely@spanx.com", emailStatus: "found" });
  const again = store.upsertContact({ list: "l", fullName: "Sara Blakely", org: "Spanx", title: "Founder" });
  assert.equal(again.id, c.id);
  assert.equal(again.email, "sblakely@spanx.com");
  assert.equal(again.title, "Founder");
  assert.deepEqual(store.knownEmailsForDomain("spanx.com"), [{ first: "sara", last: "blakely", email: "sblakely@spanx.com" }]);
});

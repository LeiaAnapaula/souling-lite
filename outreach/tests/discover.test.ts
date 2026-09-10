import { test } from "node:test";
import assert from "node:assert/strict";
import { emailBelongsTo, extractBookingLinks, extractEmails, extractSocial } from "../lib/discover.ts";

test("extractEmails finds plain, mailto, entity-encoded and obfuscated addresses", () => {
  const html = `
    <a href="mailto:Sara@Spanx.com">email</a>
    press&#64;spanx.com
    <p>reach me: sara [at] blakely [dot] com</p>
    <img src="logo@2x.png">
    <script>x="a8f9e7d6c5b4@sentry.io"</script>
  `;
  const emails = extractEmails(html);
  assert.ok(emails.includes("sara@spanx.com"));
  assert.ok(emails.includes("press@spanx.com"));
  assert.ok(emails.includes("sara@blakely.com"));
  assert.ok(!emails.some((e) => e.endsWith(".png")));
  assert.ok(!emails.some((e) => e.endsWith("sentry.io")));
});

test("extractBookingLinks finds calendly and cal.com", () => {
  const html = `Book here: https://calendly.com/leia/15min. Or https://cal.com/leia/intro?x=1" and https://example.com/not`;
  assert.deepEqual(extractBookingLinks(html), ["https://calendly.com/leia/15min", "https://cal.com/leia/intro?x=1"]);
});

test("extractSocial picks profile links and skips share links", () => {
  const s = extractSocial(`<a href="https://twitter.com/intent/tweet">x</a><a href="https://x.com/peterthiel">p</a>
    <a href="https://www.linkedin.com/in/sara-blakely-1">li</a> <a href="https://github.com/login">no</a> <a href="https://github.com/torvalds">gh</a>`);
  assert.equal(s.twitter, "https://x.com/peterthiel");
  assert.equal(s.linkedin, "https://www.linkedin.com/in/sara-blakely-1");
  assert.equal(s.github, "https://github.com/torvalds");
});

test("emailBelongsTo classifies person vs generic vs other", () => {
  assert.equal(emailBelongsTo("sblakely@spanx.com", "Sara", "Blakely"), "person");
  assert.equal(emailBelongsTo("sara@spanx.com", "Sara", "Blakely"), "person");
  assert.equal(emailBelongsTo("press@spanx.com", "Sara", "Blakely"), "generic");
  assert.equal(emailBelongsTo("john@spanx.com", "Sara", "Blakely"), "other");
});

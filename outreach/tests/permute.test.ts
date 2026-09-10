import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiToken, detectPattern, domainFromUrl, learnPattern, parseName, permutations } from "../lib/permute.ts";

test("parseName handles honorifics, suffixes, particles and accents", () => {
  assert.deepEqual(parseName("Dr. Sara Blakely"), { first: "sara", last: "blakely", middle: "" });
  assert.deepEqual(parseName("Robert Herjavec Jr."), { first: "robert", last: "herjavec", middle: "" });
  assert.deepEqual(parseName("Ludwig van Beethoven"), { first: "ludwig", last: "vanbeethoven", middle: "" });
  assert.deepEqual(parseName("José Ñoño"), { first: "jose", last: "nono", middle: "" });
  assert.deepEqual(parseName("Mary Anne Smith-Jones"), { first: "mary", last: "smithjones", middle: "anne" });
  assert.deepEqual(parseName("Madonna"), { first: "madonna", last: "", middle: "" });
  assert.equal(asciiToken("O'Leary"), "oleary");
});

test("permutations are ranked, deduplicated and domain-normalised", () => {
  const p = permutations(parseName("Sara Blakely"), "https://www.spanx.com/pages/about");
  assert.equal(p[0].email, "sara@spanx.com");
  assert.equal(p[1].email, "sara.blakely@spanx.com");
  assert.ok(p.some((x) => x.email === "sblakely@spanx.com"));
  const emails = p.map((x) => x.email);
  assert.equal(new Set(emails).size, emails.length);
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].score >= p[i].score);
});

test("a learned pattern jumps to the top", () => {
  const learned = learnPattern([
    { first: "Mark", last: "Cuban", email: "mcuban@example.com" },
    { first: "Kevin", last: "OLeary", email: "koleary@example.com" },
    { first: "Lori", last: "Greiner", email: "lori.greiner@example.com" },
  ]);
  assert.equal(learned, "flast");
  const p = permutations(parseName("Barbara Corcoran"), "example.com", learned);
  assert.equal(p[0].email, "bcorcoran@example.com");
  assert.equal(p[0].score, 0.95);
});

test("detectPattern recognises common formats", () => {
  const n = parseName("Peter Thiel");
  assert.equal(detectPattern("peter@founders.fund", n), "first");
  assert.equal(detectPattern("pthiel@founders.fund", n), "flast");
  assert.equal(detectPattern("peter.thiel@founders.fund", n), "first.last");
  assert.equal(detectPattern("ceo@founders.fund", n), null);
});

test("single-name people only get the first-name pattern", () => {
  const p = permutations(parseName("Madonna"), "madonna.com");
  assert.deepEqual(p.map((x) => x.email), ["madonna@madonna.com"]);
});

test("domainFromUrl", () => {
  assert.equal(domainFromUrl("https://www.forbes.com/profile/x"), "forbes.com");
  assert.equal(domainFromUrl("thielfellowship.org"), "thielfellowship.org");
  assert.equal(domainFromUrl(""), "");
});

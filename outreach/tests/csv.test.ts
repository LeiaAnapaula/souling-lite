import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../lib/csv.ts";

test("parseCsv handles quotes, commas and CRLF", () => {
  const rows = parseCsv('Name,Org,Notes\r\n"Blakely, Sara",Spanx,"said ""hi""\nthen left"\r\nMark Cuban,,\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Blakely, Sara");
  assert.equal(rows[0].notes, 'said "hi"\nthen left');
  assert.equal(rows[1].org, "");
});

test("toCsv round-trips", () => {
  const csv = toCsv([{ a: 'x,"y"', b: 1 }], ["a", "b"]);
  assert.deepEqual(parseCsv(csv), [{ a: 'x,"y"', b: "1" }]);
});

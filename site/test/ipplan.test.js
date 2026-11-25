// Runs the shared cases in tests/cases/ against the JavaScript checker. Run: node --test site/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { check, carve, info } from "../public/ipplan.js";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "cases");
const load = (f) => JSON.parse(readFileSync(join(CASES, f), "utf8"));

for (const f of readdirSync(join(CASES, "check")).filter((x) => x.endsWith(".json")).sort()) {
  const c = load(join("check", f));
  test(`check ${c.name}`, () => {
    const got = [...new Set(check(c.plan).map((x) => x.code))].sort();
    assert.deepEqual(got, [...new Set(c.expect)].sort());
  });
}

for (const c of load("info.json")) {
  test(`info ${c.input}`, () => {
    const got = info(c.input);
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, k);
  });
}

for (const c of load("carve.json")) {
  test(`carve ${c.name}`, () => {
    const got = carve(c.parent, c.requests, c.avoid);
    assert.equal(got.ok, c.expect.ok, got.error);
    for (const [name, cidr] of Object.entries(c.expect.cidrs || {}))
      assert.equal(got.segments.find((s) => s.name === name)?.cidr, cidr, name);
    if (c.expect.free != null) assert.equal(got.free, c.expect.free);
  });
}

test("a carved segment checks clean inside a plan", () => {
  const r = carve("192.168.100.0/24", [{ name: "users", hosts: 50 }]);
  assert.deepEqual(check({ schema: 1, name: "t", segments: r.segments }), []);
});

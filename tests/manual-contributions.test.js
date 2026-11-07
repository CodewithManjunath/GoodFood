const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isPlatformAdmin,
  normalizeReference,
  parseDonationAmount
} = require("../server.js");

test("manual contribution amounts use INR precision and enforce the minimum", () => {
  assert.equal(parseDonationAmount("1"), 100);
  assert.equal(parseDonationAmount("1.2"), 120);
  assert.equal(parseDonationAmount("250.00"), 25000);
  assert.equal(parseDonationAmount("0.99"), null);
  assert.equal(parseDonationAmount("1.001"), null);
  assert.equal(parseDonationAmount("01.00"), null);
  assert.equal(parseDonationAmount("1e3"), null);
  assert.equal(parseDonationAmount(10), null);
});

test("manual review uses normalized references and trusted app metadata only", () => {
  assert.equal(normalizeReference("  abc 123 "), "ABC 123");
  assert.equal(normalizeReference("ABC 123"), normalizeReference("abc   123"));
  assert.equal(isPlatformAdmin({ app_metadata: { role: "admin" } }), true);
  assert.equal(isPlatformAdmin({ appMetadata: { role: "admin" } }), true);
  assert.equal(isPlatformAdmin({ user_metadata: { role: "admin" } }), false);
  assert.equal(isPlatformAdmin({ app_metadata: { role: "donor" } }), false);
  assert.equal(isPlatformAdmin(null), false);
});

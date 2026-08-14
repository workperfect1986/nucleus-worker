import assert from "node:assert/strict";
import test from "node:test";
import { nucleusCompanies } from "../services/nucleus-worker/companies.mjs";

test("keeps the 20 Nucleus companies with unique ids", () => {
  assert.equal(nucleusCompanies.length, 20);
  assert.equal(new Set(nucleusCompanies.map((company) => company.name)).size, 20);
  assert.equal(new Set(nucleusCompanies.map((company) => company.id)).size, 20);
  assert.ok(nucleusCompanies.every((company) => /^\d+$/.test(company.id)));
});

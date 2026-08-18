import assert from "node:assert/strict";
import test from "node:test";
import { nucleusCompanies } from "../services/nucleus-worker/companies.mjs";

test("keeps the 21 Nucleus companies with unique ids", () => {
  assert.equal(nucleusCompanies.length, 21);
  assert.equal(new Set(nucleusCompanies.map((company) => company.name)).size, 21);
  assert.equal(new Set(nucleusCompanies.map((company) => company.id)).size, 21);
  assert.ok(nucleusCompanies.every((company) => /^\d+$/.test(company.id)));
});

test("uses the dedicated RIONOVO orders URL", () => {
  const company = nucleusCompanies.find((item) => item.id === "17618");
  assert.equal(company?.name, "RIONOVO");
  assert.match(company?.ordersUrl ?? "", /ordem_servico\?/);
  assert.match(company?.ordersUrl ?? "", /company_id=17618/);
  assert.match(company?.ordersUrl ?? "", /user_id=7012/);
});

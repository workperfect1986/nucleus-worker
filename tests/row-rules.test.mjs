import assert from "node:assert/strict";
import test from "node:test";
import { isClosedRow } from "../services/nucleus-worker/row-rules.mjs";

test("does not send closed orders to stage lookup", () => {
  assert.equal(isClosedRow({ label: "OS 123 Encerrado" }), true);
  assert.equal(isClosedRow({ status: "Encerrado" }), true);
  assert.equal(isClosedRow({ label: "OS 123 Em produção" }), false);
});

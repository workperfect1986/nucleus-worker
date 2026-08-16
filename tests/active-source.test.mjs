import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeVersionKey, buildActiveUrl, mergeActiveOrders } from "../services/nucleus-worker/active-source.mjs";

test("active flow ignores the selected creation period", () => {
  const url = new URL(buildActiveUrl("https://nucleus.example/fluxo_servicos?date_de=01%2F08%2F2026", "17110", {
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
  }, 3));

  assert.equal(url.searchParams.get("company_id"), "17110");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("date_de"), "");
  assert.equal(url.searchParams.get("date_ate"), "");
});

test("keeps old active rows and enriches matching period details", () => {
  const activeRows = [
    { id: "101", companyId: "17110", name: "Trabalho antigo", status: "Gravação" },
    { id: "102", companyId: "17110", name: "Trabalho recente", status: "Montagem" },
  ];
  const enriched = mergeActiveOrders(activeRows, [{
    id: "102",
    companyId: "17110",
    client: "CETI",
    type: "Laser",
    createdAt: "15/08/2026 às 10:00",
  }]);

  assert.equal(enriched.length, 2);
  assert.equal(enriched[0].name, "Trabalho antigo");
  assert.equal(enriched[0].status, "Gravação");
  assert.equal(enriched[1].type, "Laser");
  assert.equal(enriched[1].createdAt, "15/08/2026 às 10:00");
  assert.equal(enriched[1].isClosed, false);
});

test("keeps versions of the same OS separate and authoritative", () => {
  const activeRows = [{
    id: "234558",
    companyId: "31227",
    version: "2",
    status: "Finalização",
    label: "Versão 1 encerrada · Versão 2 finalização",
  }];
  const details = [
    { id: "234558", companyId: "31227", version: "1", type: "Tipo encerrado", isClosed: true },
    { id: "234558", companyId: "31227", version: "2", type: "Tipo ativo", isClosed: false },
  ];

  const [merged] = mergeActiveOrders(activeRows, details);
  assert.equal(merged.version, "2");
  assert.equal(merged.type, "Tipo ativo");
  assert.equal(merged.status, "Finalização");
  assert.equal(merged.isClosed, false);
  assert.notEqual(activeVersionKey(details[0]), activeVersionKey(details[1]));
});

test("both extraction modes load the authoritative active flow", async () => {
  const [browserExtractor, httpExtractor] = await Promise.all([
    readFile(new URL("../services/nucleus-worker/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/nucleus-worker/http-extractor.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(browserExtractor, /extractByCompanies\(context, filters, activeUrl, "active"\)/);
  assert.match(httpExtractor, /extractActiveCompany\(client, config\.activeUrl/);
  assert.match(httpExtractor, /filters\.source === "active" \? enrichedActiveOrders/);
});

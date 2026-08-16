import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Studio Laser login page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Studio Laser · Visão operacional<\/title>/i);
  assert.match(html, /Central de trabalhos/);
  assert.match(html, /E-mail do Nucleus/);
  assert.match(html, /Entrar e carregar dados/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("keeps the application metadata and assets scoped to Studio Laser", async () => {
  const [page, reportPage, styles, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/relatorios/report-page-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /normalizeWorkOrders/);
  assert.match(page, /Dados carregados/);
  assert.match(page, /Ordens por cliente/);
  assert.match(page, /Período de apuração/);
  assert.match(page, /periodStart.*periodEnd/);
  assert.doesNotMatch(page, />Aguardando <span className="stat-icon/);
  assert.match(page, /className="site-header"/);
  assert.match(page, /className="header-nav"/);
  assert.doesNotMatch(page, /className="sidebar"/);
  assert.match(reportPage, /className="site-header"/);
  assert.doesNotMatch(reportPage, /className="sidebar"/);
  assert.match(page, /mobile-bottom-nav/);
  assert.match(page, /auth-preview/);
  const closedTable = page.slice(page.indexOf('{tab === "closed"'), page.indexOf('<div className="mobile-order-list">'));
  assert.match(closedTable, /Cliente \/ nome/);
  assert.match(closedTable, /toggleSort\("createdAt"\)/);
  assert.match(closedTable, />Etapa <span>/);
  assert.doesNotMatch(closedTable, /toggleSort\("work"\)|toggleSort\("technology"\)/);
  assert.doesNotMatch(closedTable, /toggleSort\("type"\)|>Tipo <span>|type-pill/);
  assert.match(page, /ordersInPeriod/);
  assert.match(page, /ordersInPeriod\.filter/);
  assert.doesNotMatch(page, /Todos os tipos|Filtrar tipo|type-pill/);
  assert.match(reportPage, /frost-stats report-stats/);
  assert.match(reportPage, /report-mobile-order-list/);
  assert.match(reportPage, /snapshotOrdersInPeriod/);
  assert.match(reportPage, /<th>Ordem<\/th><th>Cliente \/ Nome<\/th><th>Criado em<\/th><th>Status<\/th>/);
  assert.doesNotMatch(reportPage, /Todos os tipos|Filtrar tipo|type-pill|>Tipo<|order\.type/);
  assert.match(styles, /Frost authentication/);
  assert.match(styles, /Frost reports/);
  assert.match(layout, /Studio Laser · Visão operacional/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /favicon\.svg/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|sites-preview/i);

  await assert.rejects(
    access(new URL("public/_sites-preview", templateRoot)),
  );
});

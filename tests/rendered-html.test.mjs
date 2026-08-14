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
  assert.match(html, /<title>Studio Laser · Central de trabalhos<\/title>/i);
  assert.match(html, /Central de trabalhos/);
  assert.match(html, /E-mail do Nucleus/);
  assert.match(html, /Entrar e carregar dados/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("keeps the application metadata and assets scoped to Studio Laser", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /normalizeWorkOrders/);
  assert.match(page, /Nucleus conectado/);
  assert.match(layout, /title:\s*"Studio Laser · Central de trabalhos"/);
  assert.match(layout, /favicon\.svg/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|sites-preview/i);

  await assert.rejects(
    access(new URL("public/_sites-preview", templateRoot)),
  );
});

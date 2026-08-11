import http from "node:http";
import { chromium } from "playwright";

const port = Number(process.env.PORT || 8787);
const target = process.env.NUCLEUS_URL || "https://studiolaser.nucleusapp.com.br";
const ordersUrl = process.env.NUCLEUS_ORDERS_URL || "https://studiolaser.nucleusapp.com.br/ordem_servico?utf8=%E2%9C%93&chave=&os_id=&work_order_id=&company_id=&date_de=&date_ate=&cod_produto=&id_terceiro=&tipo=&classificacao=&situacao=&tecnologia=&material=&espessura=&nivel_dificuldade=&user_id=7012&finalizado=&cod_barras=&local_gravacao_id=&calculo_z=&financial_system_code=&commit=Filtrar";
const productionUrl = process.env.NUCLEUS_PRODUCTION_URL || `${target}/dashboard/production`;
const maxPages = Number(process.env.NUCLEUS_MAX_PAGES || 10000);
const stageConcurrency = Math.max(1, Math.min(12, Number(process.env.NUCLEUS_STAGE_CONCURRENCY || 6)));

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; if (body.length > 32_000) reject(new Error("Payload too large")); });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    request.on("error", reject);
  });
}

function formatQueryDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

async function login(page, credentials) {
  await page.goto(`${target}/login`, { waitUntil: "domcontentloaded" });
  const fields = page.getByRole("textbox");
  await fields.nth(0).fill(credentials.email);
  await fields.nth(1).fill(credentials.password);
  await Promise.all([page.waitForLoadState("domcontentloaded"), page.getByRole("button", { name: "Entrar" }).click()]);
  const body = await page.locator("body").innerText();
  if (page.url().includes("/login")) throw new Error("Nucleus authentication failed");
  if (/captcha|código de verificação|autenticação em dois fatores/i.test(body)) throw new Error("Nucleus requires CAPTCHA or 2FA");
}

function isClosedRow(row) {
  return /encerrado/i.test(`${row.label || ""} ${row.status || ""}`);
}

function htmlToText(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractStages(context, rows) {
  const activeRowsById = new Map();
  for (const row of rows) {
    if (!isClosedRow(row) && row.id) activeRowsById.set(String(row.id).trim(), row);
  }
  const activeRows = Array.from(activeRowsById.values());
  if (!activeRows.length) return { stagesProcessed: 0, stageErrors: 0 };

  let nextIndex = 0;
  let stageErrors = 0;
  const workers = Array.from({ length: Math.min(stageConcurrency, activeRows.length) }, async () => {
    while (nextIndex < activeRows.length) {
      const row = activeRows[nextIndex];
      nextIndex += 1;
      try {
        const flowUrl = new URL(`${target}/fluxo_servicos`);
        flowUrl.searchParams.set("utf8", "✓");
        flowUrl.searchParams.set("aba", "todos");
        flowUrl.searchParams.set("chave", "");
        flowUrl.searchParams.set("os_id", row.id);
        const flowResponse = await context.request.get(flowUrl.toString(), { timeout: 20_000, failOnStatusCode: false });
        if (flowResponse.url().includes("/login")) throw new Error("Nucleus session expired during stage extraction");
        if (!flowResponse.ok()) throw new Error(`Nucleus stage request failed with status ${flowResponse.status()}`);

        const html = await flowResponse.text();
        const stageCell = html.match(/<td\b[^>]*\bid=["']etapa-atual-os-[^"']+["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
        row.status = htmlToText(stageCell) || "Etapa não localizada";
      } catch (error) {
        if (error instanceof Error && error.message.includes("session expired")) throw error;
        row.status = "Etapa indisponível";
        stageErrors += 1;
      }
    }
  });

  await Promise.all(workers);
  return { stagesProcessed: activeRows.length, stageErrors };
}

async function extract(credentials, filters = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, credentials);

    const rows = [];
    const seen = new Set();
    const currentMonth = getCurrentMonthRange();
    const effectiveDateFrom = filters.dateFrom || currentMonth.from;
    const effectiveDateTo = filters.dateTo || currentMonth.to;
    let totalPages = 1;
    let pagesProcessed = 0;
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const filteredPageUrl = new URL(ordersUrl);
      filteredPageUrl.searchParams.set("page", String(pageNumber));
      if (filters.clientId) filteredPageUrl.searchParams.set("company_id", filters.clientId);
      filteredPageUrl.searchParams.set("date_de", formatQueryDate(effectiveDateFrom));
      filteredPageUrl.searchParams.set("date_ate", formatQueryDate(effectiveDateTo));
      await page.goto(filteredPageUrl.toString(), { waitUntil: "domcontentloaded" });
      if (page.url().includes("/login")) throw new Error("Nucleus session expired during extraction");
      pagesProcessed += 1;
      const pageRows = await page.locator("table tbody tr").evaluateAll((elements) => elements.map((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.trim());
        const companyHref = row.querySelector("td:nth-child(2) a")?.getAttribute("href") || "";
        const clientId = companyHref.match(/\/crm\/companies\/(\d+)/)?.[1];
        return { id: cells[0], clientId, client: cells[1], name: cells[2], version: cells[3], order: cells[4], technology: cells[5], thickness: cells[6], type: cells[7], createdAt: cells[8], work: cells[9], label: cells[2] };
      }));
      if (!pageRows.length) break;
      for (const row of pageRows) {
        const key = `${row.id}:${row.work}`;
        if (!seen.has(key)) { seen.add(key); rows.push(row); }
      }
      const pageNumbers = await page.locator('a[href*="page="]').evaluateAll((links) => links.map((link) => {
        try {
          const href = link.getAttribute("href");
          if (!href) return 0;
          const parsed = new URL(href, window.location.origin);
          if (parsed.pathname !== "/ordem_servico") return 0;
          return Number(parsed.searchParams.get("page")) || 0;
        } catch { return 0; }
      }));
      totalPages = Math.max(totalPages, ...pageNumbers, pageNumber);
      if (pageNumber >= totalPages) break;
    }
    const stageResult = await extractStages(context, rows);
    return { rows, pagesProcessed, totalPages, ...stageResult };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function extractProductionStats(credentials) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, credentials);
    await page.goto(productionUrl, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) throw new Error("Nucleus session expired during extraction");

    const metricLabel = page.getByText("Total cm2 do usuário", { exact: true });
    await metricLabel.waitFor({ state: "visible", timeout: 20_000 });
    const metricText = await metricLabel.locator("xpath=..").locator("h2").innerText();
    const rawValue = metricText.replace(/\s*Cm2\s*/i, "").trim();
    const normalizedValue = rawValue.includes(",")
      ? rawValue.replace(/\./g, "").replace(",", ".")
      : rawValue;
    const totalCm2 = Number(normalizedValue);
    if (!Number.isFinite(totalCm2)) throw new Error("Nucleus production metric has an unexpected format");

    return { totalCm2, rawValue };
  } finally {
    await context.close();
    await browser.close();
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "http://localhost:3000");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
    response.writeHead(200);
    response.end(JSON.stringify({ status: "ok", service: "nucleus-worker", endpoints: ["POST /extract", "POST /production-stats"] }));
    return;
  }
  if (request.method !== "POST" || !["/extract", "/production-stats"].includes(request.url)) { response.writeHead(404); response.end(JSON.stringify({ error: "Not found" })); return; }
  try {
    const body = await readJson(request);
    const credentials = request.url === "/production-stats"
      ? { email: body.email || process.env.NUCLEUS_EMAIL, password: body.password || process.env.NUCLEUS_PASSWORD }
      : { email: body.email, password: body.password };
    if (!credentials.email || !credentials.password) throw new Error("Credentials are required");
    if (request.url === "/production-stats") {
      const result = await extractProductionStats(credentials);
      response.writeHead(200); response.end(JSON.stringify({ ...result, extractedAt: new Date().toISOString() }));
      return;
    }
    const result = await extract(credentials, body.filters);
    response.writeHead(200); response.end(JSON.stringify({ orders: result.rows, pagesProcessed: result.pagesProcessed, totalPages: result.totalPages, stagesProcessed: result.stagesProcessed, stageErrors: result.stageErrors, extractedAt: new Date().toISOString() }));
  } catch (error) {
    response.writeHead(502); response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Extraction failed" }));
  }
});

server.listen(port, () => console.log(`Nucleus worker listening on ${port}`));

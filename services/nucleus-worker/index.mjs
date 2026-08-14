import http from "node:http";
import { chromium } from "playwright";
import { nucleusCompanies } from "./companies.mjs";

const port = Number(process.env.PORT || 8787);
const target = process.env.NUCLEUS_URL || "https://studiolaser.nucleusapp.com.br";
const ordersUrl = process.env.NUCLEUS_ORDERS_URL || "https://studiolaser.nucleusapp.com.br/ordem_servico?utf8=%E2%9C%93&chave=&os_id=&work_order_id=&company_id=&date_de=&date_ate=&cod_produto=&id_terceiro=&tipo=&classificacao=&situacao=&tecnologia=&material=&espessura=&nivel_dificuldade=&user_id=&finalizado=&cod_barras=&local_gravacao_id=&calculo_z=&financial_system_code=&commit=Filtrar";
const activeUrl = process.env.NUCLEUS_ACTIVE_URL || "https://studiolaser.nucleusapp.com.br/fluxo_servicos?utf8=%E2%9C%93&aba=todos&chave=&os_id=&work_order_id=&company_id=&date_de=&date_ate=&date_despacho_de=&date_despacho_ate=&user_id=&tipo=&classificacao=&situacao=&tecnologia=&material=&espessura=&nivel_dificuldade=&id_terceiro=&cod_produto=&cod_barras=&local_gravacao_id=&commit=Filtrar";
const productionUrl = process.env.NUCLEUS_PRODUCTION_URL || `${target}/dashboard/production`;
const maxPages = Number(process.env.NUCLEUS_MAX_PAGES || 10000);
const companyConcurrency = Number(process.env.NUCLEUS_COMPANY_CONCURRENCY || 4);
const statusConcurrency = Number(process.env.NUCLEUS_STATUS_CONCURRENCY || 6);

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

function resolveCredentials(body) {
  if (body?.email && body?.password) {
    return { email: body.email, password: body.password };
  }

  return {
    email: process.env.NUCLEUS_EMAIL,
    password: process.env.NUCLEUS_PASSWORD,
  };
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

function normalizeOrderId(value) {
  return String(value || "").replace(/^#/, "").trim();
}

async function recoverFlowRows(context, rows, filters) {
  const candidates = Array.from(new Map(rows
    .filter((row) => !isClosedRow(row) && row.id)
    .map((row) => [normalizeOrderId(row.id), row])).values());
  const recovered = [];
  let nextIndex = 0;
  const pages = await Promise.all(Array.from({ length: Math.min(statusConcurrency, candidates.length) }, () => context.newPage()));
  const workers = pages.map(async (page) => {
    while (nextIndex < candidates.length) {
      const row = candidates[nextIndex];
      nextIndex += 1;
      try {
        const flowUrl = new URL(activeUrl);
        flowUrl.searchParams.set("os_id", normalizeOrderId(row.id));
        flowUrl.searchParams.set("user_id", filters.userId || "");
        flowUrl.searchParams.set("company_id", "");
        flowUrl.searchParams.set("date_de", "");
        flowUrl.searchParams.set("date_ate", "");
        await page.goto(flowUrl.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (page.url().includes("/login")) continue;
        const stageCell = page.locator('td[id^="etapa-atual-os-"]').first();
        let stage = (await stageCell.innerText({ timeout: 10_000 }).catch(() => "")).trim();
        if (!stage) {
          stage = await page.locator("table tbody tr").first().evaluate((tableRow) => {
            const table = tableRow.closest("table");
            const headers = Array.from(table?.querySelectorAll("thead th") || []).map((cell) => cell.textContent?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() || "");
            const stageIndex = headers.findIndex((header) => header.includes("etapa") || header.includes("status"));
            return stageIndex >= 0 ? tableRow.querySelectorAll("td")[stageIndex]?.textContent?.trim() || "" : "";
          }).catch(() => "");
        }
        if (stage) recovered.push({ ...row, status: stage });
      } catch {
        // A missing lookup must not interrupt the main extraction.
      }
    }
  });
  await Promise.all(workers);
  await Promise.all(pages.map((page) => page.close()));
  return recovered;
}

async function extractSource(page, sourceUrl, filters, source, companyId) {
  const rows = [];
  const seen = new Set();
  const currentMonth = getCurrentMonthRange();
  const effectiveDateFrom = filters.dateFrom || currentMonth.from;
  const effectiveDateTo = filters.dateTo || currentMonth.to;
  let totalPages = 1;
  let pagesProcessed = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const filteredPageUrl = new URL(sourceUrl);
    filteredPageUrl.searchParams.set("page", String(pageNumber));
    if (companyId) filteredPageUrl.searchParams.set("company_id", companyId);
    // Keep the empty user filter from both source URLs unless the caller
    // explicitly selected a user.
    if (filters.userId) filteredPageUrl.searchParams.set("user_id", filters.userId);
    filteredPageUrl.searchParams.set("date_de", formatQueryDate(effectiveDateFrom));
    filteredPageUrl.searchParams.set("date_ate", formatQueryDate(effectiveDateTo));
    await page.goto(filteredPageUrl.toString(), { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) throw new Error("Nucleus session expired during extraction");
    pagesProcessed += 1;

    const pageRows = await page.locator("table tbody tr").evaluateAll((elements, currentSource) => elements.map((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.trim());
      const companyHref = row.querySelector('a[href*="/crm/companies/"]')?.getAttribute("href") || "";
      const clientId = companyHref.match(/\/crm\/companies\/(\d+)/)?.[1];
      const stage = row.querySelector('[id^="etapa-atual-os-"]')?.textContent?.trim() || "";
      if (currentSource === "active") {
        const normalizeHeader = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const headers = Array.from(row.closest("table")?.querySelectorAll("thead th") || []).map((cell) => normalizeHeader(cell.textContent || ""));
        const column = (...names) => {
          const index = headers.findIndex((header) => names.some((name) => header.includes(name)));
          return index >= 0 ? cells[index] || "" : "";
        };
        return {
          id: column("id os", "os") || cells[0],
          version: column("versao") || cells[1],
          order: column("pedido") || cells[2],
          name: column("nome") || cells[3],
          client: column("cliente") || cells[4],
          status: stage || column("etapa", "status") || cells[5],
          clientId, label: row.innerText,
        };
      }
      return {
        id: cells[0], clientId, client: cells[1], name: cells[2], version: cells[3], order: cells[4],
        technology: cells[5], thickness: cells[6], type: cells[7], createdAt: cells[8], work: cells[9],
        status: "", label: row.innerText,
      };
    }), source);

    const selectedRows = source === "orders" ? pageRows : pageRows.filter((row) => !isClosedRow(row));
    for (const row of selectedRows) {
      const key = `${row.id}:${row.work}`;
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
    if (!pageRows.length) break;

    const pageNumbers = await page.locator('a[href*="page="]').evaluateAll((links, currentSource) => links.map((link) => {
      try {
        const href = link.getAttribute("href");
        if (!href) return 0;
        const parsed = new URL(href, window.location.origin);
        if (parsed.pathname !== (currentSource === "active" ? "/fluxo_servicos" : "/ordem_servico")) return 0;
        return Number(parsed.searchParams.get("page")) || 0;
      } catch { return 0; }
    }), source);
    totalPages = Math.max(totalPages, ...pageNumbers, pageNumber);
    if (pageNumber >= totalPages) break;
  }
  return { rows, pagesProcessed, totalPages };
}

async function extractOrdersByCompanies(context, filters) {
  const companies = filters.clientId
    ? nucleusCompanies.filter((company) => company.id === String(filters.clientId))
    : nucleusCompanies;
  const rows = [];
  let pagesProcessed = 0;
  let totalPages = 0;
  let nextIndex = 0;
  const workers = await Promise.all(Array.from({ length: Math.min(companyConcurrency, companies.length) }, () => context.newPage()));

  await Promise.all(workers.map(async (page) => {
    while (nextIndex < companies.length) {
      const company = companies[nextIndex];
      nextIndex += 1;
      const result = await extractSource(page, ordersUrl, filters, "orders", company.id);
      pagesProcessed += result.pagesProcessed;
      totalPages += result.totalPages;
      rows.push(...result.rows.map((row) => ({ ...row, companyId: company.id, companyName: company.name })));
    }
  }));
  await Promise.all(workers.map((page) => page.close()));
  return { rows, pagesProcessed, totalPages };
}

async function extract(credentials, filters = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, credentials);
    const source = filters.source || "all";
    const ordersSource = await extractOrdersByCompanies(context, filters);
    const orders = ordersSource.rows;
    if (source === "closed") {
      return { rows: orders.filter((row) => isClosedRow(row)), pagesProcessed: ordersSource.pagesProcessed, totalPages: ordersSource.totalPages, stagesProcessed: 0, stageErrors: 0 };
    }
    const recoveredFlowRows = await recoverFlowRows(context, orders, filters);
    const statusById = new Map(recoveredFlowRows.map((row) => [normalizeOrderId(row.id), row.status]));
    const rows = orders.map((row) => ({
      ...row,
      status: statusById.get(normalizeOrderId(row.id)) || row.status || "Não localizado no fluxo",
    })).filter((row) => source !== "active" || !isClosedRow(row));
    return {
      rows,
      pagesProcessed: ordersSource.pagesProcessed,
      totalPages: ordersSource.totalPages,
      stagesProcessed: recoveredFlowRows.length,
      stageErrors: orders.filter((row) => !isClosedRow(row) && !statusById.has(normalizeOrderId(row.id))).length,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function extractFilterOptions(credentials) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, credentials);
    const filterOptionsUrl = new URL(ordersUrl);
    filterOptionsUrl.searchParams.set("user_id", "");
    await page.goto(filterOptionsUrl.toString(), { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) throw new Error("Nucleus session expired during client extraction");

    const options = await page.locator('select[name="company_id"] option').evaluateAll((elements) => elements.map((option) => ({
      id: option.getAttribute("value")?.trim() || "",
      label: option.textContent?.trim() || "",
    })).filter((option) => option.id && option.label));
    const users = await page.locator('select[name="user_id"] option').evaluateAll((elements) => elements.map((option) => ({
      id: option.getAttribute("value")?.trim() || "",
      label: option.textContent?.trim() || "",
    })).filter((option) => option.id && option.label));
    return {
      clients: Array.from(new Map(options.map((option) => [option.id, option])).values()).sort((left, right) => left.label.localeCompare(right.label, "pt-BR")),
      users: Array.from(new Map(users.map((option) => [option.id, option])).values()).sort((left, right) => left.label.localeCompare(right.label, "pt-BR")),
    };
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
    response.end(JSON.stringify({ status: "ok", service: "nucleus-worker", endpoints: ["POST /extract", "POST /production-stats", "GET /clients"] }));
    return;
  }
  if (request.method === "GET" && request.url === "/clients") {
    try {
      const credentials = resolveCredentials({});
      if (!credentials.email || !credentials.password) throw new Error("Credentials are required");
       const filterOptions = await extractFilterOptions(credentials);
       response.writeHead(200); response.end(JSON.stringify(filterOptions));
    } catch (error) {
      response.writeHead(502); response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Client extraction failed" }));
    }
    return;
  }
  if (request.method !== "POST" || !["/extract", "/production-stats"].includes(request.url)) { response.writeHead(404); response.end(JSON.stringify({ error: "Not found" })); return; }
  try {
    const body = await readJson(request);
    const credentials = resolveCredentials(body);
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

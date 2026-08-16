import * as cheerio from "cheerio";
import { activeVersionKey, buildActiveUrl, mergeActiveOrders } from "./active-source.mjs";
import { nucleusCompanies } from "./companies.mjs";
import { isClosedRow } from "./row-rules.mjs";

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (compatible; Studio-Laser-Worker/1.0)",
  Accept: "text/html,application/xhtml+xml",
};
const orderCache = new Map();
const statusCache = new Map();
const defaultOrderCacheTtlMs = 30 * 60 * 1000;
const defaultStatusCacheTtlMs = 5 * 60 * 1000;

function formatQueryDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function currentMonthRange() {
  const now = new Date();
  const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function normalizeId(value) {
  return String(value || "").replace(/^#/, "").trim();
}

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]+)/) : [];
}

class SessionClient {
  constructor() {
    this.cookies = new Map();
    this.metrics = { requests: 0, requestMs: 0 };
  }

  cookieHeader() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }

  saveCookies(headers) {
    for (const cookie of readSetCookies(headers)) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  async request(url, options = {}) {
    const startedAt = Date.now();
    let currentUrl = url;
    let method = options.method || "GET";
    let body = options.body;
    for (let redirect = 0; redirect < 6; redirect += 1) {
      const response = await fetch(currentUrl, {
        ...options,
        method,
        body,
        redirect: "manual",
        headers: {
          ...defaultHeaders,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
          ...(options.headers || {}),
        },
      });
      this.metrics.requests += 1;
      this.saveCookies(response.headers);
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        this.metrics.requestMs += Date.now() - startedAt;
        return response;
      }
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303 || (response.status >= 300 && response.status <= 303)) {
        method = "GET";
        body = undefined;
      }
    }
    throw new Error("Nucleus returned too many redirects");
  }
}

function formDataFromLogin(html, credentials, target) {
  const $ = cheerio.load(html);
  const form = $("form").has('input[type="password"]').first();
  if (!form.length) throw new Error("Nucleus login form not found");
  const data = new URLSearchParams();
  form.find("input[name]").each((_, input) => data.set($(input).attr("name"), $(input).attr("value") || ""));
  const emailInput = form.find('input[type="email"], input[name*="email" i], input[name*="login" i]').first();
  const passwordInput = form.find('input[type="password"]').first();
  if (!emailInput.attr("name") || !passwordInput.attr("name")) throw new Error("Nucleus login fields not found");
  data.set(emailInput.attr("name"), credentials.email);
  data.set(passwordInput.attr("name"), credentials.password);
  return { action: new URL(form.attr("action") || "/login", target).toString(), data };
}

async function login(client, credentials, target) {
  const loginResponse = await client.request(`${target}/login`);
  const loginHtml = await loginResponse.text();
  const { action, data } = formDataFromLogin(loginHtml, credentials, target);
  const response = await client.request(action, { method: "POST", body: data.toString() });
  const html = await response.text();
  if (response.url.includes("/login") || /input[^>]+type=["']password/i.test(html)) {
    throw new Error("Nucleus authentication failed");
  }
}

function buildOrdersUrl(baseUrl, companyId, filters, pageNumber) {
  const url = new URL(baseUrl);
  const range = currentMonthRange();
  url.searchParams.set("company_id", companyId);
  url.searchParams.set("page", String(pageNumber));
  url.searchParams.set("date_de", formatQueryDate(filters.dateFrom || range.from));
  url.searchParams.set("date_ate", formatQueryDate(filters.dateTo || range.to));
  if (filters.userId) url.searchParams.set("user_id", filters.userId);
  return url.toString();
}

function parseOrders(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => $(cell).text().trim()).get();
    if (!cells.length) return;
    const companyHref = $(row).find('a[href*="/crm/companies/"]').attr("href") || "";
    rows.push({
      id: cells[0],
      clientId: companyHref.match(/\/crm\/companies\/(\d+)/)?.[1],
      client: cells[1], name: cells[2], version: cells[3], order: cells[4],
      technology: cells[5], thickness: cells[6], type: cells[7], createdAt: cells[8], work: cells[9],
      status: "", label: $(row).text().trim(),
    });
  });
  const pages = $("a[href*='page=']").map((_, link) => Number(new URL($(link).attr("href"), "https://studiolaser.nucleusapp.com.br").searchParams.get("page")) || 0).get();
  return { rows, totalPages: Math.max(1, ...pages) };
}

export function parseActiveOrders(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => $(cell).text().trim()).get();
    if (!cells.length) return;
    const headers = $(row).closest("table").find("thead th").map((__, cell) => $(cell).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()).get();
    const readColumn = (names, fallbackIndex) => {
      const index = headers.findIndex((header) => names.some((name) => header.includes(name)));
      return cells[index >= 0 ? index : fallbackIndex] || "";
    };
    const companyHref = $(row).find('a[href*="/crm/companies/"]').attr("href") || "";
    rows.push({
      id: readColumn(["id os", "os"], 0),
      version: readColumn(["versao"], 1),
      order: readColumn(["pedido"], 2),
      name: readColumn(["nome"], 3),
      client: readColumn(["cliente"], 4),
      status: $(row).find("td[id^='etapa-atual-os-']").first().text().trim() || readColumn(["etapa", "status"], 5),
      clientId: companyHref.match(/\/crm\/companies\/(\d+)/)?.[1],
      label: $(row).text().trim(),
    });
  });
  const pages = $("a[href*='page=']").map((_, link) => Number(new URL($(link).attr("href"), "https://studiolaser.nucleusapp.com.br").searchParams.get("page")) || 0).get();
  return { rows, totalPages: Math.max(1, ...pages) };
}

async function extractCompany(client, baseUrl, company, filters, maxPages, cacheNamespace) {
  const cacheKey = JSON.stringify([cacheNamespace, company.id, filters.dateFrom || "", filters.dateTo || "", filters.userId || ""]);
  const cached = orderCache.get(cacheKey);
  const cachedIsValid = cached && Date.now() - cached.updatedAt < defaultOrderCacheTtlMs;
  const cachedRows = cachedIsValid ? cached.rows : [];
  const cachedKeys = new Set(cachedRows.map((row) => JSON.stringify(row)));
  const freshRows = [];
  const seen = new Set();
  let totalPages = 0;
  let pagesProcessed = 0;
  let incrementalStop = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.request(buildOrdersUrl(baseUrl, company.id, filters, page));
    if (!response.ok) throw new Error(`Nucleus orders returned HTTP ${response.status}`);
    const parsed = parseOrders(await response.text());
    pagesProcessed += 1;
    totalPages = Math.max(totalPages, parsed.totalPages, page);
    for (const row of parsed.rows) {
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        freshRows.push({ ...row, companyId: company.id, companyName: company.name });
      }
    }
    if (!parsed.rows.length) break;
    if (cachedIsValid && page >= 1 && parsed.rows.every((row) => cachedKeys.has(JSON.stringify(row)))) {
      incrementalStop = true;
      break;
    }
  }
  const mergedRows = new Map(cachedRows.map((row) => [JSON.stringify(row), row]));
  for (const row of freshRows) mergedRows.set(JSON.stringify(row), row);
  const rows = Array.from(mergedRows.values());
  orderCache.set(cacheKey, { rows, updatedAt: Date.now() });
  return {
    rows,
    pagesProcessed,
    totalPages,
    cached: cachedIsValid,
    cachedRows: cachedRows.length,
    newRows: freshRows.filter((row) => !cachedKeys.has(JSON.stringify(row))).length,
    incrementalStop,
  };
}

async function extractActiveCompany(client, baseUrl, company, filters, maxPages) {
  const rows = [];
  const seen = new Set();
  let totalPages = 0;
  let pagesProcessed = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.request(buildActiveUrl(baseUrl, company.id, filters, page));
    if (!response.ok) throw new Error(`Nucleus active flow returned HTTP ${response.status}`);
    const parsed = parseActiveOrders(await response.text());
    pagesProcessed += 1;
    totalPages = Math.max(totalPages, parsed.totalPages, page);
    for (const row of parsed.rows) {
      const id = normalizeId(row.id);
      const key = activeVersionKey(row);
      if (id && !seen.has(key)) {
        seen.add(key);
        rows.push({ ...row, companyId: company.id, companyName: company.name, isClosed: false });
      }
    }
    if (!parsed.rows.length) break;
  }
  return { rows, pagesProcessed, totalPages };
}

async function extractStatus(client, baseUrl, row, filters) {
  const url = new URL(baseUrl);
  url.searchParams.set("os_id", normalizeId(row.id));
  url.searchParams.set("company_id", "");
  url.searchParams.set("date_de", "");
  url.searchParams.set("date_ate", "");
  if (filters.userId) url.searchParams.set("user_id", filters.userId);
  const response = await client.request(url.toString());
  if (!response.ok) return "";
  const $ = cheerio.load(await response.text());
  const directStage = $("td[id^='etapa-atual-os-']").first().text().trim();
  if (directStage) return directStage;
  let status = "";
  $("table thead th").each((index, header) => {
    const label = $(header).text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!status && (label.includes("etapa") || label.includes("status"))) status = $("table tbody tr").first().find("td").eq(index).text().trim();
  });
  return status;
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}

export async function extractWithHttp(credentials, filters, config) {
  const client = new SessionClient();
  const startedAt = Date.now();
  await login(client, credentials, config.target);
  const companies = filters.clientId ? nucleusCompanies.filter((company) => company.id === String(filters.clientId)) : nucleusCompanies;
  const cacheNamespace = credentials.email || "anonymous";
  const extracted = await mapWithConcurrency(companies, config.companyConcurrency, (company) => extractCompany(client, config.ordersUrl, company, filters, config.maxPages, cacheNamespace));
  const orders = extracted.flatMap((result) => result.rows);
  const pagesProcessed = extracted.reduce((sum, result) => sum + result.pagesProcessed, 0);
  const totalPages = extracted.reduce((sum, result) => sum + result.totalPages, 0);
  const metrics = {
    mode: "http",
    durationMs: Date.now() - startedAt,
    companiesRequested: companies.length,
    companiesCached: extracted.filter((result) => result.cached).length,
    pagesProcessed,
    pagesSavedByIncremental: extracted.filter((result) => result.incrementalStop).length,
    cachedOrders: extracted.reduce((sum, result) => sum + result.cachedRows, 0),
    newOrders: extracted.reduce((sum, result) => sum + result.newRows, 0),
    statusCacheHits: 0,
    statusRequests: 0,
    httpRequests: client.metrics.requests,
    httpRequestMs: client.metrics.requestMs,
  };
  if (filters.source === "closed") {
    metrics.httpRequests = client.metrics.requests;
    metrics.httpRequestMs = client.metrics.requestMs;
    metrics.durationMs = Date.now() - startedAt;
    return { rows: orders.filter(isClosedRow), pagesProcessed, totalPages, stagesProcessed: 0, stageErrors: 0, metrics };
  }
  const activeExtracted = await mapWithConcurrency(companies, config.companyConcurrency, (company) => extractActiveCompany(client, config.activeUrl, company, filters, config.maxPages));
  const activeOrders = mergeActiveOrders(activeExtracted.flatMap((result) => result.rows), orders);
  const statuses = await mapWithConcurrency(activeOrders, config.statusConcurrency, async (row) => {
    if (row.status) return row.status;
    const key = `${cacheNamespace}:${activeVersionKey(row)}:${filters.userId || ""}`;
    const cached = statusCache.get(key);
    if (cached && Date.now() - cached.updatedAt < defaultStatusCacheTtlMs) {
      metrics.statusCacheHits += 1;
      return cached.status;
    }
    metrics.statusRequests += 1;
    const status = await extractStatus(client, config.activeUrl, row, filters);
    statusCache.set(key, { status, updatedAt: Date.now() });
    return status;
  });
  const statusByVersion = new Map();
  activeOrders.forEach((row, index) => { if (statuses[index]) statusByVersion.set(activeVersionKey(row), statuses[index]); });
  const enrichedActiveOrders = activeOrders.map((row) => ({ ...row, status: statusByVersion.get(activeVersionKey(row)) || row.status || "Não localizado no fluxo" }));
  const rows = filters.source === "active" ? enrichedActiveOrders : [...orders.filter(isClosedRow), ...enrichedActiveOrders];
  const activePagesProcessed = activeExtracted.reduce((sum, result) => sum + result.pagesProcessed, 0);
  const activeTotalPages = activeExtracted.reduce((sum, result) => sum + result.totalPages, 0);
  metrics.pagesProcessed += activePagesProcessed;
  metrics.activePagesProcessed = activePagesProcessed;
  metrics.httpRequests = client.metrics.requests;
  metrics.httpRequestMs = client.metrics.requestMs;
  metrics.durationMs = Date.now() - startedAt;
  return { rows, pagesProcessed: pagesProcessed + activePagesProcessed, totalPages: totalPages + activeTotalPages, stagesProcessed: statuses.filter(Boolean).length, stageErrors: statuses.filter((status) => !status).length, metrics };
}

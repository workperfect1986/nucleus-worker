function normalizeId(value) {
  return String(value || "").replace(/^#/, "").trim();
}

export function buildActiveUrl(baseUrl, companyId, filters, pageNumber) {
  const url = new URL(baseUrl);
  url.searchParams.set("company_id", companyId);
  url.searchParams.set("page", String(pageNumber));
  url.searchParams.set("date_de", "");
  url.searchParams.set("date_ate", "");
  url.searchParams.set("date_despacho_de", "");
  url.searchParams.set("date_despacho_ate", "");
  if (filters.userId) url.searchParams.set("user_id", filters.userId);
  return url.toString();
}

const orderKey = (row) => `${row.companyId || row.clientId || ""}:${normalizeId(row.id)}`;

export function mergeActiveOrders(activeOrders, orderDetails) {
  const detailsByKey = new Map(orderDetails.map((row) => [orderKey(row), row]));
  return activeOrders.map((row) => ({
    ...(detailsByKey.get(orderKey(row)) || {}),
    ...row,
    status: row.status || detailsByKey.get(orderKey(row))?.status || "Não localizado no fluxo",
  }));
}

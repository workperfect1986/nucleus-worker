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

export function activeVersionKey(row) {
  return `${normalizeId(row.id)}:${String(row.version || "").trim()}:${String(row.order || "").trim()}`;
}

const orderKey = (row, includeVersion = true) => `${row.companyId || row.clientId || ""}:${normalizeId(row.id)}${includeVersion ? `:${String(row.version || "").trim()}` : ""}`;

export function mergeActiveOrders(activeOrders, orderDetails) {
  const detailsByVersion = new Map(orderDetails.map((row) => [orderKey(row), row]));
  const detailsByOrder = new Map(orderDetails.map((row) => [orderKey(row, false), row]));
  return activeOrders.map((row) => {
    const details = detailsByVersion.get(orderKey(row)) || detailsByOrder.get(orderKey(row, false));
    return {
      ...(details || {}),
      ...row,
      status: row.status || details?.status || "Não localizado no fluxo",
      isClosed: false,
    };
  });
}

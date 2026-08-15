export type WorkOrder = {
  id: string;
  clientId?: string;
  client: string;
  name: string;
  version: string;
  order: string;
  technology: string;
  thickness: string;
  type: string;
  createdAt: string;
  work: string;
  status: string;
  isClosed: boolean;
};

export type RawWorkOrder = Partial<WorkOrder> & { finalizado?: string; label?: string };

/** Keeps the external source rule in one place so the UI never depends on Nucleus markup. */
export function isClosedWorkOrder(row: RawWorkOrder): boolean {
  const statusText = `${row.finalizado ?? ""} ${row.label ?? ""} ${row.status ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return row.isClosed === true || /encerrad|finalizad|concluid/.test(statusText);
}

export function normalizeWorkOrders(rows: RawWorkOrder[]): WorkOrder[] {
  return rows.map((row) => ({
    id: row.id ?? "—", client: row.client ?? "Cliente não informado", name: row.name ?? "Sem nome",
    clientId: row.clientId,
    version: row.version ?? "—", order: row.order ?? "—", technology: row.technology ?? "—",
    thickness: row.thickness ?? "—", type: row.type ?? "—", createdAt: row.createdAt ?? "—",
    work: row.work ?? "—", status: row.status ?? (isClosedWorkOrder(row) ? "Encerrado" : "Sem status"),
    isClosed: isClosedWorkOrder(row),
  }));
}

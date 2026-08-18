export function isClosedRow(row) {
  if (typeof row.isClosed === "boolean") return row.isClosed;
  const labelText = String(row.clientId || row.companyId || "") === "17618" ? "" : row.label || "";
  const statusText = `${row.finalizado || ""} ${labelText} ${row.status || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /encerrad|finalizad|concluid/.test(statusText);
}

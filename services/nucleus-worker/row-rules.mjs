export function isClosedRow(row) {
  const statusText = `${row.finalizado || ""} ${row.label || ""} ${row.status || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /encerrad|finalizad|concluid/.test(statusText);
}

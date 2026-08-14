export function isClosedRow(row) {
  return /encerrado/i.test(`${row.label || ""} ${row.status || ""}`);
}

export type NucleusStatusTone =
  | "development-recording"
  | "assembly-bl"
  | "development-bl"
  | "re-recording-bl"
  | "recording-bl"
  | "assembly-be"
  | "development-be"
  | "re-recording-be"
  | "recording-fast"
  | "recording-simple-fast"
  | "jpg"
  | "complex-change"
  | "simple-change"
  | "proof"
  | "urgent-replacement"
  | "default";

export function getNucleusStatusTone(status: string, isClosed = false): NucleusStatusTone {
  if (isClosed) return "proof";

  const normalized = status
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

  if (normalized.includes("desenvolvimento/gravacao")) return "development-recording";
  if (normalized.includes("montagem/bl")) return "assembly-bl";
  if (normalized.includes("desenvolvimento/bl")) return "development-bl";
  if (normalized.includes("regravacao/bl")) return "re-recording-bl";
  if (normalized.includes("gravacao/bl")) return "recording-bl";
  if (normalized.includes("montagem/be")) return "assembly-be";
  if (normalized.includes("desenvolvimento/be")) return "development-be";
  if (normalized.includes("regravacao/be")) return "re-recording-be";
  if (normalized.includes("gravacao/befast")) return "recording-fast";
  if (normalized.includes("gravacao/besimplesfast")) return "recording-simple-fast";
  if (normalized === "jpg" || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("alteracaocomplexa")) return "complex-change";
  if (normalized.includes("alteracaosimples")) return "simple-change";
  if (normalized.includes("prova")) return "proof";
  if (normalized.includes("reposicao") || normalized.includes("urgencia")) return "urgent-replacement";
  return "default";
}

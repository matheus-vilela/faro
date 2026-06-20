/**
 * NF-e / import: unidade comercial (uCom) ou tributável → código guardado em `products.unit`.
 * Alinhado ao batch `process-import-job-batch` e ao assist de linha (pré-visualização).
 */

function normalizeAscii(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function mapInvoiceUnitToCatalogUnit(raw: string | null | undefined): {
  unit: string;
  needsReview: boolean;
  rawUnit: string | null;
} {
  const original = String(raw ?? "").trim();
  if (!original) {
    return { unit: "un", needsReview: true, rawUnit: null };
  }
  const t = normalizeAscii(original);
  const aliases: Record<string, string> = {
    un: "un",
    und: "un",
    uni: "un",
    unidade: "un",
    cx: "cx",
    caixa: "cx",
    pct: "pct",
    pac: "pct",
    pacote: "pct",
    kg: "kg",
    g: "g",
    l: "l",
    litro: "l",
    ml: "ml",
    fardo: "fd",
    fd: "fd",
    galao: "gl",
    galão: "gl",
    galoes: "gl",
    galões: "gl",
    gl: "gl",
  };
  if (aliases[t]) {
    return { unit: aliases[t], needsReview: false, rawUnit: original };
  }
  return {
    unit:
      original
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "")
        .slice(0, 24) || "un",
    needsReview: true,
    rawUnit: original,
  };
}

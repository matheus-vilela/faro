export function parseLooseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function extractXmlVnfTotal(xmlText: string): number | null {
  const matches = [...xmlText.matchAll(/<vNF>\s*([^<]+)\s*<\/vNF>/gi)];
  if (matches.length === 0) return null;
  let best = 0;
  for (const m of matches) {
    const candidate = parseLooseNumber(m[1] ?? "");
    if (Number.isFinite(candidate) && candidate > best) best = candidate;
  }
  return best > 0 ? Math.round(best * 100) / 100 : null;
}

export function resolveDocumentTotal(input: {
  extractedTotal: unknown;
  xmlText: string;
  summedLines: number;
}): { total: number | null; source: "extracted_total" | "xml_vnf" | "summed_lines" | "none" } {
  const fromExtractedTotal = parseLooseNumber(input.extractedTotal);
  const fromXmlVnfTotal = extractXmlVnfTotal(input.xmlText);
  if (Number.isFinite(fromExtractedTotal) && fromExtractedTotal > 0) {
    return { total: fromExtractedTotal, source: "extracted_total" };
  }
  if (Number.isFinite(fromXmlVnfTotal) && (fromXmlVnfTotal ?? 0) > 0) {
    return { total: fromXmlVnfTotal, source: "xml_vnf" };
  }
  if (Number.isFinite(input.summedLines) && input.summedLines > 0) {
    return { total: input.summedLines, source: "summed_lines" };
  }
  return { total: null, source: "none" };
}

export function shouldCreateExpense(hasActiveDuplicate: boolean): boolean {
  return !hasActiveDuplicate;
}


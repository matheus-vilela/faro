import type { Boleto } from "@/types/expense";

/** Remove prefixos legados nas descrições do fluxo (dados antigos). */
function stripLegacyFluxoPrefixes(description: string): string {
  return description
    .replace(/^Receita:\s*/iu, "")
    .replace(/^Despesa:\s*/iu, "")
    .trim();
}

const LEGACY_REVENUE_TAX_SUFFIX =
  /^(.+?)\s*-\s*Taxas\/dedu[cç][oõ]es\s*$/iu;

export function formatBoletoFluxoDescription(
  b: Pick<Boleto, "description">,
): string {
  const raw = b.description?.trim() ?? "";
  if (!raw) return raw;

  const taxMatch = raw.match(LEGACY_REVENUE_TAX_SUFFIX);
  if (taxMatch) {
    const inner = stripLegacyFluxoPrefixes(taxMatch[1] ?? "");
    if (/^venda\s*—/i.test(inner) || inner === "Venda produtos") {
      return "Taxas/Deduções - Venda produtos";
    }
    if (inner === "Venda por receita") {
      return "Taxas/Deduções - Venda por receita";
    }
    return inner ? `Taxas/Deduções - ${inner}` : "Taxas/Deduções";
  }

  if (/CMV\s*$/iu.test(stripLegacyFluxoPrefixes(raw))) {
    return "CMV - Venda produtos";
  }

  return stripLegacyFluxoPrefixes(raw);
}

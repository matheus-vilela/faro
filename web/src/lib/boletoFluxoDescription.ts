import type { Boleto } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";

/**
 * Texto exibido no fluxo de caixa. Boletos a pagar gerados com receita antiga
 * vinham como "Receita: … - Taxas/deducoes"; para saídas usa-se "Despesa:".
 */
const LEGACY_REVENUE_TAX_PAYABLE =
  /^Receita:\s*(.+?)\s*-\s*Taxas\/dedu[cç][oõ]es\s*$/iu;
const LEGACY_REVENUE_CMV_PAYABLE = /^Receita:\s*.+\s*-\s*CMV\s*$/iu;
/** Alinhado a Receitas: `Venda — ${nome do produto}` (travessão EM DASH). */
const PRODUCT_SALE_TITLE = /^Venda\s*—\s*/i;

export function formatBoletoFluxoDescription(b: Boleto): string {
  const d = b.description;
  if (!isBoletoPayable(b)) return d;

  const taxMatch = d.match(LEGACY_REVENUE_TAX_PAYABLE);
  if (taxMatch) {
    const inner = taxMatch[1]?.trim() ?? "";
    if (PRODUCT_SALE_TITLE.test(inner)) {
      return "Despesa: Taxas/Deduções - Venda produtos";
    }
    return `Despesa: Taxas/Deduções - ${inner}`;
  }

  if (LEGACY_REVENUE_CMV_PAYABLE.test(d)) {
    return "Despesa: CMV - Venda produtos";
  }

  return d;
}

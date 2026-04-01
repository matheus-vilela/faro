import { categoryPathLabel } from "@/lib/companyCategoryLabels";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, BoletoCategory } from "@/types/expense";

type BoletoCategoryRef = Pick<Boleto, "category" | "company_category_id">;

/** Labels para UI (cadastro, listas, resumo). */
export const BOLETO_CATEGORY_LABELS: Record<BoletoCategory, string> = {
  insumos: "Insumos / matéria-prima",
  fornecedores: "Fornecedores",
  custo_fixo: "Custo fixo",
  estabelecimento: "Estabelecimento",
  outros: "Outros",
};

/** Texto curto para calendário e espaços apertados. */
export const BOLETO_CATEGORY_SHORT: Record<BoletoCategory, string> = {
  insumos: "Insumos",
  fornecedores: "Fornec.",
  custo_fixo: "Fixo",
  estabelecimento: "Estab.",
  outros: "Outros",
};

export const BOLETO_CATEGORY_ORDER: BoletoCategory[] = [
  "insumos",
  "fornecedores",
  "custo_fixo",
  "estabelecimento",
  "outros",
];

/** Rótulo completo: personalizada (pai › filho) ou enum legado. */
export function formatBoletoCategoryLabel(
  boleto: BoletoCategoryRef,
  byId: Map<string, CompanyCategory>,
): string {
  if (boleto.company_category_id) {
    const row = byId.get(boleto.company_category_id);
    if (row) {
      return categoryPathLabel(row.id, byId);
    }
  }
  const c = boleto.category;
  if (c && c in BOLETO_CATEGORY_LABELS) {
    return BOLETO_CATEGORY_LABELS[c as BoletoCategory];
  }
  return BOLETO_CATEGORY_LABELS.outros;
}

/** Texto curto para calendário / listas compactas. */
export function formatBoletoCategoryShort(
  boleto: BoletoCategoryRef,
  byId: Map<string, CompanyCategory>,
): string {
  if (boleto.company_category_id) {
    const full = formatBoletoCategoryLabel(boleto, byId);
    if (full.length <= 10) return full;
    if (full.includes("›")) {
      const leaf = full.split("›").pop()?.trim() ?? full;
      return leaf.length <= 10 ? leaf : `${leaf.slice(0, 9)}…`;
    }
    return `${full.slice(0, 9)}…`;
  }
  const c = boleto.category;
  if (c && c in BOLETO_CATEGORY_SHORT) {
    return BOLETO_CATEGORY_SHORT[c as BoletoCategory];
  }
  return BOLETO_CATEGORY_SHORT.outros;
}

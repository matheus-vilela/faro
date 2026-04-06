import { ptBrUi } from "@/lib/ptBrUiStrings";
import type { CompanyCategory, NaturezaCategoria, TipoCategoria } from "@/types/category";

/**
 * Nome exibido em listagens e caminhos; o texto no banco pode vir com encoding
 * ruim em seeds antigos para a folha padrão de deduções da receita.
 */
export function companyCategoryDisplayName(cat: CompanyCategory): string {
  const isDeducaoOpReceita =
    cat.papel_receita_dre === "DEDUCAO" &&
    cat.natureza === "RECEITA" &&
    cat.tipo === "OPERACIONAL";
  if (!isDeducaoOpReceita) return cat.name;

  if (cat.padrao_sistema) {
    return ptBrUi.dre.deducoesReceitaLabel;
  }

  if (/da receita\s*\/\s*despesas sobre vendas/i.test(cat.name)) {
    return ptBrUi.dre.deducoesReceitaLabel;
  }

  return cat.name;
}

export const NATUREZA_LABEL: Record<NaturezaCategoria, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
};

export const TIPO_LABEL: Record<TipoCategoria, string> = {
  OPERACIONAL: "Operacional",
  NAO_OPERACIONAL: "Não operacional",
  CMV: "CMV",
  VARIAVEL: "Despesa variável",
  FIXA: "Despesa fixa",
  IMPOSTOS: "Impostos",
  INVESTIMENTOS_FINANCIAMENTOS: "Investimentos e financiamentos",
};

export function categoryPathLabel(
  id: string,
  byId: Map<string, CompanyCategory>,
): string {
  const parts: string[] = [];
  let cur: CompanyCategory | undefined = byId.get(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(companyCategoryDisplayName(cur));
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(" › ");
}

export function buildChildrenMap(rows: CompanyCategory[]) {
  const map = new Map<string, CompanyCategory[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = map.get(row.parent_id) ?? [];
    list.push(row);
    map.set(row.parent_id, list);
  }
  return map;
}

export function isLeafCategory(
  id: string,
  childrenMap: Map<string, CompanyCategory[]>,
): boolean {
  return (childrenMap.get(id) ?? []).length === 0;
}

export function isSelectableDespesaLeaf(c: CompanyCategory): boolean {
  const natureza = c.natureza ?? "DESPESA";
  const ativa = c.ativo !== false;
  return natureza === "DESPESA" && ativa;
}

export function isSelectableReceitaLeaf(c: CompanyCategory): boolean {
  const natureza = c.natureza ?? "DESPESA";
  const ativa = c.ativo !== false;
  return natureza === "RECEITA" && ativa;
}

/** Qualquer categoria CMV (despesa) ativa: folhas ou nós intermediários (ex.: grupo CMV › subgrupo). */
export function isSelectableCmvCategory(c: CompanyCategory): boolean {
  const ativa = c.ativo !== false;
  return c.natureza === "DESPESA" && c.tipo === "CMV" && ativa;
}

/**
 * CMV no cadastro de produto: subs (qualquer profundidade), exclui o nó raiz "CMV"
 * (`parent_id` nulo).
 */
export function isSelectableCmvProductGroup(c: CompanyCategory): boolean {
  return isSelectableCmvCategory(c) && c.parent_id != null;
}

/** @deprecated use isSelectableCmvCategory */
export const isSelectableCmvLeaf = isSelectableCmvCategory;

export function tipoBadge(c: CompanyCategory): string {
  return TIPO_LABEL[c.tipo] ?? "—";
}

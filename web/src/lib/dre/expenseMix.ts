import {
  buildChildrenMap,
  companyCategoryDisplayName,
} from "@/lib/companyCategoryLabels";
import type { CompanyCategory } from "@/types/category";
import { mapCategoryToDreBucket } from "./dreMapping";

export type ExpenseMixItem = {
  id: string;
  name: string;
  amount: number;
  percent: number;
};

const OPEX_BUCKETS = new Set([
  "DESPESAS_VARIAVEIS",
  "DESPESAS_FIXAS",
  "RESULTADO_FINANCEIRO_DESPESA",
  "IMPOSTOS",
]);

/**
 * Agrupa despesas operacionais pelas raízes das categorias (top N).
 * Usa o total da subárvore alocado aos buckets de opex.
 */
export function buildExpenseMix(
  categories: CompanyCategory[],
  byCategoryId: Map<string, number>,
  limit = 5,
): ExpenseMixItem[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenMap = buildChildrenMap(categories);

  function opexTotal(catId: string): number {
    const cat = byId.get(catId);
    if (!cat) return 0;
    const bucket = mapCategoryToDreBucket(cat);
    let self =
      bucket !== "EXCLUDE" &&
      bucket !== "UNMAPPED" &&
      OPEX_BUCKETS.has(bucket)
        ? (byCategoryId.get(catId) ?? 0)
        : 0;
    for (const ch of childrenMap.get(catId) ?? []) {
      self += opexTotal(ch.id);
    }
    return self;
  }

  const roots = categories.filter(
    (c) =>
      !c.parent_id &&
      c.natureza === "DESPESA" &&
      c.ativo !== false,
  );

  const items: ExpenseMixItem[] = [];
  for (const root of roots) {
    const amount = opexTotal(root.id);
    if (amount <= 0) continue;
    items.push({
      id: root.id,
      name: companyCategoryDisplayName(root),
      amount,
      percent: 0,
    });
  }

  // Folhas órfãs (sem pai no conjunto) com opex
  for (const [id, amount] of byCategoryId) {
    const cat = byId.get(id);
    if (!cat || cat.natureza !== "DESPESA") continue;
    const bucket = mapCategoryToDreBucket(cat);
    if (!OPEX_BUCKETS.has(bucket)) continue;
    if (roots.some((r) => r.id === id)) continue;
    // já incluído via raiz?
    let underRoot = false;
    let cur: CompanyCategory | undefined = cat;
    while (cur?.parent_id) {
      if (roots.some((r) => r.id === cur!.parent_id)) {
        underRoot = true;
        break;
      }
      cur = byId.get(cur.parent_id);
    }
    if (underRoot) continue;
    items.push({
      id,
      name: companyCategoryDisplayName(cat),
      amount,
      percent: 0,
    });
  }

  items.sort((a, b) => b.amount - a.amount);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const top = items.slice(0, limit);
  const rest = items.slice(limit);
  const restSum = rest.reduce((s, i) => s + i.amount, 0);
  if (restSum > 0) {
    top.push({
      id: "__outros__",
      name: "Outros",
      amount: restSum,
      percent: 0,
    });
  }

  for (const item of top) {
    item.percent = total > 0 ? (item.amount / total) * 100 : 0;
  }
  return top;
}

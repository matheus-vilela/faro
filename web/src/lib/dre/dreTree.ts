import { buildChildrenMap } from "@/lib/companyCategoryLabels";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import type { CompanyCategory } from "@/types/category";
import type { DreBucket } from "./dreMapping";
import { mapCategoryToDreBucket } from "./dreMapping";

/** Nome exibido na árvore DRE; o texto no banco pode vir com encoding ruim em seeds/backfills antigos. */
function dreTreeCategoryDisplayName(cat: CompanyCategory): string {
  const isDeducaoOpReceita =
    cat.papel_receita_dre === "DEDUCAO" &&
    cat.natureza === "RECEITA" &&
    cat.tipo === "OPERACIONAL";
  if (!isDeducaoOpReceita) return cat.name;

  if (cat.padrao_sistema) {
    return ptBrUi.dre.deducoesReceitaLabel;
  }

  // Fallback: sufixo do plano padrão costuma ficar legível em ASCII mesmo com mojibake no prefixo
  if (/da receita\s*\/\s*despesas sobre vendas/i.test(cat.name)) {
    return ptBrUi.dre.deducoesReceitaLabel;
  }

  return cat.name;
}

export interface DreTreeNode {
  id: string;
  name: string;
  /** Total no bucket (próprio + descendentes que pertencem ao mesmo bloco DRE). */
  amount: number;
  children: DreTreeNode[];
}

function bucketSubtreeTotal(
  catId: string,
  bucket: DreBucket,
  byId: Map<string, CompanyCategory>,
  childrenMap: Map<string, CompanyCategory[]>,
  byCategoryId: Map<string, number>,
): number {
  const cat = byId.get(catId);
  if (!cat) return 0;
  const self =
    mapCategoryToDreBucket(cat) === bucket ? (byCategoryId.get(catId) ?? 0) : 0;
  let ch = 0;
  for (const c of childrenMap.get(catId) ?? []) {
    ch += bucketSubtreeTotal(c.id, bucket, byId, childrenMap, byCategoryId);
  }
  return self + ch;
}

/**
 * Monta árvore com hierarquia para o bucket; inclui nós ancestrais quando há valor no ramo.
 */
export function buildDreTreeForBucket(
  categories: CompanyCategory[],
  byCategoryId: Map<string, number>,
  bucket: DreBucket,
): DreTreeNode[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenMap = buildChildrenMap(categories);

  const build = (cat: CompanyCategory): DreTreeNode | null => {
    const total = bucketSubtreeTotal(cat.id, bucket, byId, childrenMap, byCategoryId);
    const chList = (childrenMap.get(cat.id) ?? []).sort(
      (a, b) => (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0),
    );
    const childNodes: DreTreeNode[] = [];
    for (const ch of chList) {
      const n = build(ch);
      if (n) childNodes.push(n);
    }
    if (total === 0 && childNodes.length === 0) return null;
    return {
      id: cat.id,
      name: dreTreeCategoryDisplayName(cat),
      amount: total,
      children: childNodes,
    };
  };

  const roots = categories.filter((c) => c.parent_id === null);
  const out: DreTreeNode[] = [];
  for (const r of roots.sort(
    (a, b) => (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0),
  )) {
    const n = build(r);
    if (n) out.push(n);
  }
  return out;
}

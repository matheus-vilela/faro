import { buildChildrenMap } from "@/lib/companyCategoryLabels";
import { mapCategoryToDreBucket, type DreBucket } from "@/lib/dre/dreMapping";
import type { CompanyCategory } from "@/types/category";
import {
  EXPENSE_BUCKET_SECTIONS,
  type BudgetComparisonNode,
  type BudgetComparisonResult,
  type BudgetComparisonSummary,
  type BudgetDeviationStatus,
  type CategoryBudgetRow,
} from "./types";

export function computeDeviationStatus(
  budgeted: number,
  actual: number,
): BudgetDeviationStatus {
  if (budgeted <= 0 && actual <= 0) return "empty";
  if (budgeted <= 0 && actual > 0) return "no_budget";

  const ratio = actual / budgeted;
  if (ratio <= 0.9) return "ok";
  if (ratio <= 1) return "warning";
  return "over";
}

export function computePercentConsumed(
  budgeted: number,
  actual: number,
): number | null {
  if (budgeted <= 0) return null;
  return (actual / budgeted) * 100;
}

function buildLeafSet(categories: CompanyCategory[]): Set<string> {
  const childrenMap = buildChildrenMap(categories);
  const hasChild = new Set<string>();
  for (const [parentId, children] of childrenMap) {
    if (children.length > 0) hasChild.add(parentId);
  }
  return new Set(categories.filter((c) => !hasChild.has(c.id)).map((c) => c.id));
}

function expenseCategories(categories: CompanyCategory[]): CompanyCategory[] {
  return categories.filter((c) => {
    if (c.natureza !== "DESPESA" || c.ativo === false) return false;
    const bucket = mapCategoryToDreBucket(c);
    return (
      bucket !== "EXCLUDE" &&
      bucket !== "UNMAPPED" &&
      bucket !== "VENDAS_BRUTAS" &&
      bucket !== "DEDUCAO_RECEITA" &&
      bucket !== "RESULTADO_FINANCEIRO_RECEITA"
    );
  });
}

function subtreeTotal(
  catId: string,
  bucket: DreBucket,
  byId: Map<string, CompanyCategory>,
  childrenMap: Map<string, CompanyCategory[]>,
  valuesByCategoryId: Map<string, number>,
): number {
  const cat = byId.get(catId);
  if (!cat) return 0;

  let total = 0;
  if (mapCategoryToDreBucket(cat) === bucket) {
    total += valuesByCategoryId.get(catId) ?? 0;
  }
  for (const child of childrenMap.get(catId) ?? []) {
    total += subtreeTotal(child.id, bucket, byId, childrenMap, valuesByCategoryId);
  }
  return total;
}

function buildCategoryNode(
  cat: CompanyCategory,
  bucket: DreBucket,
  byId: Map<string, CompanyCategory>,
  childrenMap: Map<string, CompanyCategory[]>,
  budgetByCategoryId: Map<string, number>,
  actualByCategoryId: Map<string, number>,
  leafIds: Set<string>,
): BudgetComparisonNode | null {
  const budgeted = subtreeTotal(
    cat.id,
    bucket,
    byId,
    childrenMap,
    budgetByCategoryId,
  );
  const actual = subtreeTotal(
    cat.id,
    bucket,
    byId,
    childrenMap,
    actualByCategoryId,
  );

  const isLeaf = leafIds.has(cat.id);
  const catBucket = mapCategoryToDreBucket(cat);

  const chList = (childrenMap.get(cat.id) ?? [])
    .filter((c) => mapCategoryToDreBucket(c) === bucket || hasDescendantInBucket(c.id, bucket, byId, childrenMap))
    .sort(
      (a, b) =>
        (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );

  const children = chList
    .map((c) =>
      buildCategoryNode(
        c,
        bucket,
        byId,
        childrenMap,
        budgetByCategoryId,
        actualByCategoryId,
        leafIds,
      ),
    )
    .filter((n): n is BudgetComparisonNode => n != null);

  if (!isLeaf && children.length === 0 && budgeted <= 0 && actual <= 0) {
    return null;
  }

  if (isLeaf && catBucket !== bucket) {
    return null;
  }

  const variance = actual - budgeted;
  const percentConsumed = computePercentConsumed(budgeted, actual);

  return {
    id: cat.id,
    name: cat.name,
    isLeaf,
    budgeted,
    actual,
    variance,
    percentConsumed,
    status: computeDeviationStatus(budgeted, actual),
    children,
    dreBucket: bucket,
  };
}

function hasDescendantInBucket(
  catId: string,
  bucket: DreBucket,
  byId: Map<string, CompanyCategory>,
  childrenMap: Map<string, CompanyCategory[]>,
): boolean {
  const cat = byId.get(catId);
  if (!cat) return false;
  if (mapCategoryToDreBucket(cat) === bucket) return true;
  return (childrenMap.get(catId) ?? []).some((c) =>
    hasDescendantInBucket(c.id, bucket, byId, childrenMap),
  );
}

function buildSummary(
  sections: BudgetComparisonNode[],
): BudgetComparisonSummary {
  let totalBudgeted = 0;
  let totalActual = 0;

  for (const section of sections) {
    totalBudgeted += section.budgeted;
    totalActual += section.actual;
  }

  const totalVariance = totalActual - totalBudgeted;
  const percentConsumed = computePercentConsumed(totalBudgeted, totalActual);

  return {
    totalBudgeted,
    totalActual,
    totalVariance,
    percentConsumed,
    aggregateStatus: computeDeviationStatus(totalBudgeted, totalActual),
  };
}

function collectChartRows(
  nodes: BudgetComparisonNode[],
  out: BudgetComparisonResult["chartRows"],
): void {
  for (const node of nodes) {
    if (node.isLeaf && (node.budgeted > 0 || node.actual > 0)) {
      out.push({
        categoryId: node.id,
        name: node.name,
        budgeted: node.budgeted,
        actual: node.actual,
        variance: node.variance,
      });
    }
    if (node.children.length) collectChartRows(node.children, out);
  }
}

export function computeBudgetComparison(input: {
  categories: CompanyCategory[];
  budgets: CategoryBudgetRow[];
  actualByCategoryId: Map<string, number>;
  /** CMV de vendas (fichas) — soma no bucket CMV. */
  salesCmv?: number;
}): BudgetComparisonResult {
  const expenseCats = expenseCategories(input.categories);
  const byId = new Map(expenseCats.map((c) => [c.id, c]));
  const childrenMap = buildChildrenMap(expenseCats);
  const leafIds = buildLeafSet(expenseCats);

  const budgetByCategoryId = new Map<string, number>();
  for (const b of input.budgets) {
    if (leafIds.has(b.categoryId)) {
      budgetByCategoryId.set(b.categoryId, b.amount);
    }
  }

  const actualByCategoryId = new Map<string, number>();
  for (const [id, amount] of input.actualByCategoryId) {
    if (byId.has(id)) actualByCategoryId.set(id, amount);
  }

  const salesCmv = Math.max(0, input.salesCmv ?? 0);

  const sections: BudgetComparisonNode[] = [];

  for (const { bucket, label } of EXPENSE_BUCKET_SECTIONS) {
    const roots = expenseCats
      .filter((c) => !c.parent_id && byId.has(c.id))
      .filter(
        (c) =>
          mapCategoryToDreBucket(c) === bucket ||
          hasDescendantInBucket(c.id, bucket, byId, childrenMap),
      )
      .sort(
        (a, b) =>
          (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0) ||
          a.name.localeCompare(b.name, "pt-BR"),
      );

    const orphanLeaves = expenseCats.filter(
      (c) =>
        leafIds.has(c.id) &&
        mapCategoryToDreBucket(c) === bucket &&
        (c.parent_id == null || !byId.has(c.parent_id)),
    );

    const rootIds = new Set(roots.map((r) => r.id));
    const extraRoots = orphanLeaves.filter((c) => !rootIds.has(c.id));

    const allRoots = [...roots, ...extraRoots].sort(
      (a, b) =>
        (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );

    const children = allRoots
      .map((c) =>
        buildCategoryNode(
          c,
          bucket,
          byId,
          childrenMap,
          budgetByCategoryId,
          actualByCategoryId,
          leafIds,
        ),
      )
      .filter((n): n is BudgetComparisonNode => n != null);

    // CMV de vendas: nó sintético quando não há boleto CMV correspondente
    if (bucket === "CMV" && salesCmv > 0) {
      children.push({
        id: "__sales_cmv__",
        name: "CMV de vendas (fichas)",
        isLeaf: false,
        budgeted: 0,
        actual: salesCmv,
        variance: salesCmv,
        percentConsumed: null,
        status: "no_budget",
        children: [],
        dreBucket: "CMV",
      });
    }

    if (children.length === 0) continue;

    const budgeted = children.reduce((s, n) => s + n.budgeted, 0);
    const actual = children.reduce((s, n) => s + n.actual, 0);

    sections.push({
      id: `section-${bucket}`,
      name: label,
      isLeaf: false,
      budgeted,
      actual,
      variance: actual - budgeted,
      percentConsumed: computePercentConsumed(budgeted, actual),
      status: computeDeviationStatus(budgeted, actual),
      children,
      dreBucket: bucket,
    });
  }

  const chartRows: BudgetComparisonResult["chartRows"] = [];
  for (const section of sections) {
    collectChartRows(section.children, chartRows);
  }
  chartRows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  return {
    sections,
    summary: buildSummary(sections),
    chartRows: chartRows.slice(0, 8),
    leafCategoryIds: leafIds,
  };
}

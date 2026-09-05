import { ncmChapter4, normalizeNcm8 } from "@/lib/ncm/normalizeNcm";
import type {
  CompanyNcmListFilter,
  CompanyNcmRow,
} from "@/types/companyNcmCategory";

export function aggregateCompanyNcms(input: {
  products: Array<{ name?: string | null; ncm?: string | null }>;
  expenseItems: Array<{ product_name?: string | null; ncm?: string | null }>;
  rules: Array<{
    ncm?: string | null;
    product_category_id?: string | null;
    dre_category_id?: string | null;
  }>;
}): CompanyNcmRow[] {
  const byNcm = new Map<
    string,
    {
      productCount: number;
      expenseItemCount: number;
      names: Set<string>;
      categoryId: string | null;
      dreCategoryId: string | null;
    }
  >();

  const ensure = (ncm: string) => {
    let row = byNcm.get(ncm);
    if (!row) {
      row = {
        productCount: 0,
        expenseItemCount: 0,
        names: new Set(),
        categoryId: null,
        dreCategoryId: null,
      };
      byNcm.set(ncm, row);
    }
    return row;
  };

  const addName = (row: { names: Set<string> }, name: string | null | undefined) => {
    const n = String(name ?? "").trim();
    if (n) row.names.add(n);
  };

  for (const p of input.products) {
    const ncm = normalizeNcm8(p.ncm);
    if (!ncm) continue;
    const row = ensure(ncm);
    row.productCount += 1;
    addName(row, p.name);
  }

  for (const item of input.expenseItems) {
    const ncm = normalizeNcm8(item.ncm);
    if (!ncm) continue;
    const row = ensure(ncm);
    row.expenseItemCount += 1;
    addName(row, item.product_name);
  }

  for (const rule of input.rules) {
    const ncm = normalizeNcm8(rule.ncm);
    if (!ncm) continue;
    const row = ensure(ncm);
    const cat = String(rule.product_category_id ?? "").trim();
    if (cat) row.categoryId = cat;
    const dre = String(rule.dre_category_id ?? "").trim();
    if (dre) row.dreCategoryId = dre;
  }

  return [...byNcm.entries()]
    .map(([ncm, row]) => ({
      ncm,
      productCount: row.productCount,
      expenseItemCount: row.expenseItemCount,
      sampleProductNames: [...row.names].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ).slice(0, 3),
      categoryId: row.categoryId,
      dreCategoryId: row.dreCategoryId,
    }))
    .sort((a, b) => {
      const aUnmapped = a.categoryId ? 1 : 0;
      const bUnmapped = b.categoryId ? 1 : 0;
      if (aUnmapped !== bUnmapped) return aUnmapped - bUnmapped;
      return a.ncm.localeCompare(b.ncm);
    });
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function filterCompanyNcms(
  rows: CompanyNcmRow[],
  filter: CompanyNcmListFilter,
  query: string,
): CompanyNcmRow[] {
  const q = normalizeSearch(query);
  const qDigits = query.replace(/\D/g, "");
  return rows.filter((row) => {
    if (filter === "unmapped" && row.categoryId) return false;
    if (filter === "mapped" && !row.categoryId) return false;
    if (!q && !qDigits) return true;
    if (qDigits && row.ncm.includes(qDigits)) return true;
    const hay = normalizeSearch(row.sampleProductNames.join(" "));
    return q.length > 0 && hay.includes(q);
  });
}

export function unmappedCount(rows: CompanyNcmRow[]): number {
  return rows.filter((r) => !r.categoryId).length;
}

export function similarUnmappedNcms(
  rows: CompanyNcmRow[],
  ncm: string,
): CompanyNcmRow[] {
  const chapter = ncmChapter4(ncm);
  if (!chapter) return [];
  return rows.filter(
    (row) =>
      row.ncm !== normalizeNcm8(ncm) &&
      !row.categoryId &&
      ncmChapter4(row.ncm) === chapter,
  );
}

import {
  mergeProductSupplierEntries,
  NFE_PRODUCT_CREATE_REFERENCE_TYPES,
  productSupplierKey,
  type ProductSupplierEntry,
} from "@/lib/productSuppliers";
import { maskCpfCnpj } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ExpenseJoin = {
  company_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_document: string | null;
  reference_date: string | null;
  created_at: string;
  suppliers:
    | { id: string; name: string; document: string | null }
    | { id: string; name: string; document: string | null }[]
    | null;
};

type ExpenseItemSupplierRow = {
  unit_value: number | null;
  created_at: string;
  expenses: ExpenseJoin | ExpenseJoin[];
};

function expenseFromRow(row: ExpenseItemSupplierRow): ExpenseJoin {
  const exp = row.expenses;
  return Array.isArray(exp) ? exp[0]! : exp;
}

function purchaseTimestamp(isoOrYmd: string): number {
  const trimmed = isoOrYmd.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = new Date(trimmed).getTime();
  return Number.isFinite(t) ? t : 0;
}

function supplierFromExpense(
  exp: ExpenseJoin,
): { id: string; name: string; document: string | null } | null {
  const raw = exp.suppliers;
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function purchaseDateFromExpense(exp: ExpenseJoin, itemCreatedAt: string): string {
  const ref = exp.reference_date?.trim();
  if (ref) return ref;
  return exp.created_at || itemCreatedAt;
}

export function aggregateProductSuppliers(
  rows: ExpenseItemSupplierRow[],
): ProductSupplierEntry[] {
  const map = new Map<string, ProductSupplierEntry>();

  for (const row of rows) {
    const exp = expenseFromRow(row);
    const linked = supplierFromExpense(exp);
    const name =
      (linked?.name ?? exp.supplier_name ?? "").trim() || "Fornecedor sem nome";
    const document =
      linked?.document ?? exp.supplier_document?.replace(/\D/g, "") ?? null;
    const supplierId = linked?.id ?? exp.supplier_id ?? null;
    const key = productSupplierKey(supplierId, name);
    const purchasedAt = purchaseDateFromExpense(exp, row.created_at);
    const unitValue =
      row.unit_value != null && Number.isFinite(Number(row.unit_value))
        ? Number(row.unit_value)
        : null;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        supplierId,
        name,
        document: document || null,
        purchaseCount: 1,
        lastPurchaseAt: purchasedAt,
        lastUnitValue: unitValue,
        viaNfe: false,
      });
      continue;
    }

    existing.purchaseCount += 1;
    if (purchaseTimestamp(purchasedAt) > purchaseTimestamp(existing.lastPurchaseAt)) {
      existing.lastPurchaseAt = purchasedAt;
      existing.lastUnitValue = unitValue;
    }
  }

  return [...map.values()];
}

function firstSupplierJoin(
  raw:
    | { id: string; name: string; document: string | null }
    | { id: string; name: string; document: string | null }[]
    | null
    | undefined,
): { id: string; name: string; document: string | null } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function lastroEntriesFromCodes(
  rows: Array<{
    supplier_id: string;
    created_at: string;
    suppliers:
      | { id: string; name: string; document: string | null }
      | { id: string; name: string; document: string | null }[]
      | null;
  }>,
): ProductSupplierEntry[] {
  const map = new Map<string, ProductSupplierEntry>();
  for (const row of rows) {
    const linked = firstSupplierJoin(row.suppliers);
    const name = (linked?.name ?? "").trim() || "Fornecedor da NF-e";
    const supplierId = linked?.id ?? row.supplier_id;
    const key = productSupplierKey(supplierId, name);
    const existing = map.get(key);
    if (
      existing &&
      purchaseTimestamp(existing.lastPurchaseAt) >=
        purchaseTimestamp(row.created_at)
    ) {
      continue;
    }
    map.set(key, {
      key,
      supplierId,
      name,
      document: linked?.document ?? null,
      purchaseCount: 0,
      lastPurchaseAt: row.created_at,
      lastUnitValue: null,
      viaNfe: true,
    });
  }
  return [...map.values()];
}

async function loadNfeMovementLastro(
  productId: string,
): Promise<ProductSupplierEntry[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("reference_id, unit_cost, created_at, reference_type")
    .eq("product_id", productId)
    .in("reference_type", [...NFE_PRODUCT_CREATE_REFERENCE_TYPES])
    .not("reference_id", "is", null)
    .limit(50);
  if (error || !data?.length) return [];

  const supplierIds = [
    ...new Set(
      data
        .map((r) => (r.reference_id != null ? String(r.reference_id) : ""))
        .filter(Boolean),
    ),
  ];
  if (supplierIds.length === 0) return [];

  const { data: suppliers, error: supErr } = await supabase
    .from("suppliers")
    .select("id, name, document")
    .in("id", supplierIds);
  if (supErr || !suppliers?.length) return [];

  const byId = new Map(
    suppliers.map((s) => [String(s.id), s] as const),
  );
  const map = new Map<string, ProductSupplierEntry>();
  for (const row of data) {
    const sid = row.reference_id != null ? String(row.reference_id) : "";
    const supplier = byId.get(sid);
    if (!supplier) continue;
    const name = (supplier.name ?? "").trim() || "Fornecedor da NF-e";
    const key = productSupplierKey(sid, name);
    const unitValue =
      row.unit_cost != null && Number(row.unit_cost) > 0
        ? Number(row.unit_cost)
        : null;
    const existing = map.get(key);
    if (
      existing &&
      purchaseTimestamp(existing.lastPurchaseAt) >=
        purchaseTimestamp(String(row.created_at))
    ) {
      continue;
    }
    map.set(key, {
      key,
      supplierId: sid,
      name,
      document: supplier.document ?? null,
      purchaseCount: 0,
      lastPurchaseAt: String(row.created_at),
      lastUnitValue: unitValue,
      viaNfe: true,
    });
  }
  return [...map.values()];
}

type Props = {
  productId: string;
  companyId: string;
  /** Só busca quando a aba Fornecedores está visível. */
  active?: boolean;
  className?: string;
};

export function ProductSuppliersSection({
  productId,
  companyId,
  active = true,
  className,
}: Props) {
  const [entries, setEntries] = useState<ProductSupplierEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!productId || !companyId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    const [expenseRes, codesRes, movementLastro] = await Promise.all([
      supabase
        .from("expense_items")
        .select(
          `
        unit_value,
        created_at,
        expenses!inner (
          company_id,
          supplier_id,
          supplier_name,
          supplier_document,
          reference_date,
          created_at,
          suppliers ( id, name, document )
        )
      `,
        )
        .eq("product_id", productId)
        .eq("expenses.company_id", companyId)
        .limit(3000),
      supabase
        .from("product_supplier_codes")
        .select("supplier_id, created_at, suppliers ( id, name, document )")
        .eq("product_id", productId)
        .eq("company_id", companyId)
        .limit(200),
      loadNfeMovementLastro(productId),
    ]);

    if (expenseRes.error) {
      console.error("[produto] fornecedores", expenseRes.error.message);
    }
    if (codesRes.error) {
      console.error("[produto] fornecedores-nfe", codesRes.error.message);
    }

    const fromExpenses = aggregateProductSuppliers(
      (expenseRes.data ?? []) as ExpenseItemSupplierRow[],
    );
    const fromCodes = lastroEntriesFromCodes(
      (codesRes.data ?? []) as Array<{
        supplier_id: string;
        created_at: string;
        suppliers:
          | { id: string; name: string; document: string | null }
          | { id: string; name: string; document: string | null }[]
          | null;
      }>,
    );
    setEntries(
      mergeProductSupplierEntries(fromExpenses, [...fromCodes, ...movementLastro]),
    );
    setLoading(false);
  }, [productId, companyId]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const formatPurchaseDate = (isoOrYmd: string) => {
    const trimmed = isoOrYmd.trim();
    if (!trimmed) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
    return new Date(trimmed).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <section className={cn(className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Fornecedores que já forneceram
        </p>
        {!loading && entries.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {entries.length === 1
              ? "1 fornecedor"
              : `${entries.length} fornecedores`}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando fornecedores...
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
          Nenhum fornecedor vinculado a este produto ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                <Truck className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-foreground">
                  {entry.name}
                </p>
                {entry.document ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {maskCpfCnpj(entry.document)}
                  </p>
                ) : null}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {entry.purchaseCount > 0 ? (
                    <>
                      Última compra em{" "}
                      <span className="font-medium text-foreground">
                        {formatPurchaseDate(entry.lastPurchaseAt)}
                      </span>
                    </>
                  ) : (
                    <>
                      Vínculo da NF-e
                      {entry.lastPurchaseAt ? (
                        <>
                          {" "}
                          em{" "}
                          <span className="font-medium text-foreground">
                            {formatPurchaseDate(entry.lastPurchaseAt)}
                          </span>
                        </>
                      ) : null}
                    </>
                  )}
                  {entry.lastUnitValue != null ? (
                    <>
                      {" "}
                      · último preço{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {formatCurrency(entry.lastUnitValue)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {entry.purchaseCount === 0
                  ? "NF-e"
                  : entry.purchaseCount === 1
                    ? "1× em notas"
                    : `${entry.purchaseCount}× em notas`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { Badge } from "@/components/ui/badge";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type HistoryRow = {
  id: string;
  product_id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  unit_cost: number | null;
  metadata_json?: { classification?: string; quantity_unit?: string } | null;
  products: { name: string; unit: string } | null;
};

export function RecipeMovementHistory({
  companyId,
  recipeId,
  outputProductId,
  active,
}: {
  companyId: string;
  recipeId: string;
  outputProductId?: string | null;
  active: boolean;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [recipeId, outputProductId]);

  const load = useCallback(async () => {
    if (!recipeId) {
      setRows([]);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const orFilter = outputProductId
      ? `reference_id.eq.${recipeId},and(product_id.eq.${outputProductId},reference_type.in.(intermediate_production,recipe,technical_sheet_backfill))`
      : `reference_id.eq.${recipeId}`;

    const { data, error, count } = await supabase
      .from("stock_movements")
      .select(
        "id, product_id, quantity, type, reference_type, reference_id, created_at, unit_cost, metadata_json, products(name, unit)",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .or(orFilter)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error(error);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as HistoryRow[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [companyId, recipeId, outputProductId, page]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando movimentações…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
        Nenhuma movimentação desta ficha ainda. Produções e baixas de insumos
        aparecem aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-background shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Quantidade</th>
              <th className="px-3 py-2 font-medium">Classificação</th>
              <th className="px-3 py-2 font-medium text-right">Custo un.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/60 last:border-b-0"
              >
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-2 font-medium">
                  {row.products?.name ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="font-normal">
                    {row.type === "in"
                      ? "Entrada"
                      : row.type === "waste"
                        ? "Perda"
                        : "Saída"}
                  </Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                  {row.metadata_json?.quantity_unit?.trim() ||
                    row.products?.unit ||
                    ""}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {movementClassificationDisplayLabel(row)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums text-muted-foreground",
                  )}
                >
                  {row.unit_cost != null
                    ? formatCurrency(Number(row.unit_cost))
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalCount > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}

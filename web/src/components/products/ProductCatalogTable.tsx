import { Checkbox } from "@/components/ui/checkbox";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  productStockValue,
  productUnitCost,
} from "@/lib/productCatalogValue";
import type { CatalogSortKey } from "@/lib/productCatalogSort";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { AlertTriangle } from "lucide-react";

export function ProductCatalogTable({
  products,
  formatCurrency,
  onOpen,
  selectable,
  selectedIds,
  onToggleSelect,
  sortKey,
  sortAsc,
  onSort,
}: {
  products: Product[];
  formatCurrency: (v: number) => string;
  onOpen: (product: Product) => void;
  selectable?: boolean;
  selectedIds: Set<string>;
  onToggleSelect?: (productId: string) => void;
  sortKey: CatalogSortKey;
  sortAsc: boolean;
  onSort: (key: CatalogSortKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            {selectable ? <th className="w-10 px-3 py-2.5" /> : null}
            <SortableTableHead
              label="Produto"
              column="name"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="SKU"
              column="sku"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Quantidade"
              column="qty"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Mínimo"
              column="min"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Preço"
              column="price"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Valor"
              column="value"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const isSaleFamily = p.stock_control_type === "SALE_FAMILY";
            const qNum = Number(p.current_quantity);
            const minNum = Number(p.min_quantity ?? 0);
            const hasAlert =
              !isSaleFamily &&
              (p.stock_has_alert ??
                (qNum < 0 || qNum <= 0 || (minNum > 0 && qNum <= minNum)));
            const unitCost = productUnitCost(p);
            const lineValue = productStockValue(p);
            return (
              <tr
                key={p.id}
                className={cn(
                  "cursor-pointer border-b border-border/60 hover:bg-muted/40",
                  hasAlert && "bg-destructive/[0.04]",
                )}
                onClick={() => onOpen(p)}
              >
                {selectable ? (
                  <td
                    className="px-3 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => onToggleSelect?.(p.id)}
                    />
                  </td>
                ) : null}
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {isSaleFamily ? (
                      <span className="text-[0.65rem] text-sky-800 dark:text-sky-200">
                        Agrupamento
                      </span>
                    ) : null}
                    {!isSaleFamily &&
                    p.stock_only_origin &&
                    !p.not_sale_grouping ? (
                      <span className="text-[0.65rem] text-amber-900 dark:text-amber-100">
                        Possível agrupamento
                      </span>
                    ) : null}
                    {hasAlert ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : null}
                    {p.is_active === false ? (
                      <span className="text-[0.65rem] text-muted-foreground">
                        Inativo
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                  {p.sku ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {qNum.toLocaleString("pt-BR")} {p.unit}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {minNum > 0
                    ? `${minNum.toLocaleString("pt-BR")} ${p.unit}`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {unitCost != null ? formatCurrency(unitCost) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {lineValue != null ? formatCurrency(lineValue) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

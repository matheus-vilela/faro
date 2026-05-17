import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import {
  buildProductConversionRowsToRender,
  isProductConversionRowLocked,
  productConversionRowLabel,
} from "@/lib/companyUnits/productConversionRows";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2 } from "lucide-react";

interface ProductUnitConversionsReadOnlyProps {
  stockUnitCode: string;
  conversions: ProductUnitConversionDraft[];
  companyId: string;
  loading?: boolean;
  className?: string;
}

export function ProductUnitConversionsReadOnly({
  stockUnitCode,
  conversions,
  companyId,
  loading,
  className = PRODUCT_SHEET_SECTION,
}: ProductUnitConversionsReadOnlyProps) {
  const unit = stockUnitCode.trim();
  const rows = buildProductConversionRowsToRender(
    companyId,
    unit,
    conversions,
  );

  return (
    <div className={className}>
      <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Conversões de unidade
      </p>
      {!unit ? (
        <p className="text-sm text-muted-foreground">
          Produto sem unidade de estoque definida.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando conversões…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma conversão cadastrada para este produto.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id ?? `${row.secondary_unit_code}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm shadow-sm"
            >
              <span>{productConversionRowLabel(row, unit)}</span>
              {isProductConversionRowLocked(row) ? (
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Travada
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

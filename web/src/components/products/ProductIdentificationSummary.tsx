import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { Badge } from "@/components/ui/badge";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ReactNode } from "react";

interface ProductIdentificationSummaryProps {
  product: Product;
  operationalTypeLabel: string;
  composesCmv: boolean;
  className?: string;
}

function FieldTile({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5">
      <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function ProductIdentificationSummary({
  product,
  operationalTypeLabel,
  composesCmv,
  className = PRODUCT_SHEET_SECTION,
}: ProductIdentificationSummaryProps) {
  const sku = product.sku?.trim();
  const barcode = product.barcode?.trim();

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Identificação
        </p>
        <Badge
          variant="secondary"
          className="h-7 gap-1.5 px-2.5 font-normal tabular-nums"
        >
          <span className="text-muted-foreground">Unidade</span>
          <span className="font-medium text-foreground">
            {systemUnitLabel(product.unit)}
          </span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            ({product.unit})
          </span>
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldTile label="SKU">
          <p className="font-mono text-sm font-medium wrap-anywhere text-foreground">
            {sku || "—"}
          </p>
        </FieldTile>
        <FieldTile label="Código de barras">
          <p className="font-mono text-sm font-medium wrap-anywhere text-foreground">
            {barcode || "—"}
          </p>
        </FieldTile>
      </div>

      <div className="mt-4 border-t border-border/60 pt-4">
        <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Classificação operacional
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTile label="Compõe CMV">
            <Badge
              variant="secondary"
              className={cn(
                "h-6 px-2 text-xs font-medium",
                composesCmv
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                  : "text-muted-foreground",
              )}
            >
              {composesCmv ? "Sim" : "Não"}
            </Badge>
          </FieldTile>
          <FieldTile label="Tipo final operacional">
            <p className="text-sm font-medium leading-snug text-foreground">
              {operationalTypeLabel}
            </p>
          </FieldTile>
        </div>
      </div>
    </div>
  );
}

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

function barcodeDigitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function BarcodeDetail({ product }: { product: Product }) {
  const ean = product.ean?.trim() || null;
  const barcode = product.barcode?.trim() || null;
  const eanDigits = ean ? barcodeDigitsOnly(ean) : "";
  const barcodeDigits = barcode ? barcodeDigitsOnly(barcode) : "";
  const codesMatch =
    eanDigits.length >= 8 &&
    barcodeDigits.length >= 8 &&
    eanDigits === barcodeDigits;

  if (ean) {
    return (
      <span className="block font-mono text-xs font-medium wrap-anywhere text-foreground">
        <span className="font-sans text-muted-foreground">EAN </span>
        {ean}
        {barcode && !codesMatch ? (
          <span className="mt-0.5 block font-mono text-[0.7rem] font-normal text-muted-foreground">
            {barcode}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="block font-mono text-xs font-medium wrap-anywhere text-foreground">
      {barcode || "—"}
    </span>
  );
}

function CompactField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5">{children}</div>
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

  return (
    <div className={cn(className, "!p-3 sm:!p-3.5")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Identificação
        </p>
        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          <span>{systemUnitLabel(product.unit)}</span>
          <span className="font-mono text-[0.6rem] opacity-80">({product.unit})</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <CompactField label="SKU">
          <span className="block font-mono text-xs font-medium wrap-anywhere text-foreground">
            {sku || "—"}
          </span>
        </CompactField>
        <CompactField label="Código de barras">
          <BarcodeDetail product={product} />
        </CompactField>
        {product.ncm?.trim() ? (
          <CompactField label="NCM">
            <span className="block font-mono text-xs font-medium text-foreground">
              {product.ncm.trim()}
            </span>
          </CompactField>
        ) : null}
        <CompactField label="CMV">
          <Badge
            variant="secondary"
            className={cn(
              "h-5 px-1.5 text-[0.65rem] font-medium",
              composesCmv
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                : "text-muted-foreground",
            )}
          >
            {composesCmv ? "Sim" : "Não"}
          </Badge>
        </CompactField>
        <CompactField label="Tipo operacional">
          <span className="block text-xs font-medium leading-snug text-foreground">
            {operationalTypeLabel}
          </span>
        </CompactField>
      </div>
      {(product.merged_catalog_names?.length ?? 0) > 0 ? (
        <p className="mt-2 text-[0.65rem] leading-snug text-muted-foreground">
          Também reconhecido como:{" "}
          {product.merged_catalog_names!.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

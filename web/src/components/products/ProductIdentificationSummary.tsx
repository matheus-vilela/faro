import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { Badge } from "@/components/ui/badge";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ReactNode } from "react";

function barcodeDigitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <p className="pt-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="min-w-0 text-sm font-medium leading-snug text-foreground">
        {children}
      </div>
    </div>
  );
}

function BarcodeValue({ product }: { product: Product }) {
  const ean = product.ean?.trim() || null;
  const barcode = product.barcode?.trim() || null;
  const eanDigits = ean ? barcodeDigitsOnly(ean) : "";
  const barcodeDigits = barcode ? barcodeDigitsOnly(barcode) : "";
  const codesMatch =
    eanDigits.length >= 8 &&
    barcodeDigits.length >= 8 &&
    eanDigits === barcodeDigits;

  if (!ean && !barcode) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (ean) {
    return (
      <div className="font-mono text-xs">
        <p>
          <span className="font-sans text-muted-foreground">EAN </span>
          {ean}
        </p>
        {barcode && !codesMatch ? (
          <p className="mt-0.5 text-[0.7rem] font-normal text-muted-foreground">
            {barcode}
          </p>
        ) : null}
      </div>
    );
  }

  return <span className="font-mono text-xs">{barcode}</span>;
}

export function ProductIdentificationSummary({
  product,
  operationalTypeLabel,
  composesCmv,
  className,
}: {
  product: Product;
  operationalTypeLabel: string;
  composesCmv: boolean;
  className?: string;
}) {
  const sku = product.sku?.trim();
  const ncm = product.ncm?.trim();
  const aliases = product.merged_catalog_names ?? [];

  return (
    <div className={cn(PRODUCT_SHEET_SECTION, "flex h-full flex-col", className)}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Identificação
        </p>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          {systemUnitLabel(product.unit)}
          <span className="font-mono opacity-70">({product.unit})</span>
        </span>
      </div>

      <div className="divide-y divide-border/70">
        <FieldRow label="SKU">
          {sku ? (
            <span className="font-mono text-xs">{sku}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </FieldRow>
        <FieldRow label="Código">
          <BarcodeValue product={product} />
        </FieldRow>
        {ncm ? (
          <FieldRow label="NCM">
            <span className="font-mono text-xs">{ncm}</span>
          </FieldRow>
        ) : null}
        <FieldRow label="CMV">
          <Badge
            variant="secondary"
            className={cn(
              "h-5 px-1.5 text-[0.65rem] font-medium",
              composesCmv
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                : "text-muted-foreground",
            )}
          >
            {composesCmv ? "Compõe" : "Não compõe"}
          </Badge>
        </FieldRow>
        <FieldRow label="Operação">
          {operationalTypeLabel}
        </FieldRow>
      </div>

      {aliases.length > 0 ? (
        <p className="mt-auto border-t border-border/70 pt-3 text-xs leading-snug text-muted-foreground">
          Também reconhecido como {aliases.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

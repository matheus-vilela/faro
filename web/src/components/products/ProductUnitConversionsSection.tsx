import { UnitConversionDialog } from "@/components/units/UnitConversionDialog";
import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { Button } from "@/components/ui/button";
import { isLockedSystemConversionPair } from "@/lib/companyUnits/convert";
import { prepareProductUnitConversionsForPersist } from "@/lib/productUnitConversionsService";
import {
  buildLockedProductConversionRows,
  buildProductConversionRowsToRender,
  productConversionRowLabel,
} from "@/lib/companyUnits/productConversionRows";
import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

interface ProductUnitConversionsSectionProps {
  companyId: string;
  /** Unidade de estoque do produto (`products.unit`) — principal das conversões. */
  stockUnitCode: string;
  value: ProductUnitConversionDraft[];
  onChange: (next: ProductUnitConversionDraft[]) => void;
  disabled?: boolean;
  sectionClassName?: string;
}

export function ProductUnitConversionsSection({
  companyId,
  stockUnitCode,
  value,
  onChange,
  disabled,
  sectionClassName = PRODUCT_SHEET_SECTION,
}: ProductUnitConversionsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const primaryMeta = useMemo(() => {
    const c = stockUnitCode.trim().toLowerCase();
    return SYSTEM_PRODUCT_UNITS.find((u) => u.code.toLowerCase() === c) ?? null;
  }, [stockUnitCode]);

  const secondaryOptions = useMemo(() => {
    const c = stockUnitCode.trim().toLowerCase();
    const used = new Set(
      value.map((v) => v.secondary_unit_code.trim().toLowerCase()),
    );
    return SYSTEM_PRODUCT_UNITS.filter(
      (u) =>
        u.code.toLowerCase() !== c &&
        !used.has(u.code.toLowerCase()) &&
        !isLockedSystemConversionPair(stockUnitCode, u.code),
    ).map((u) => ({ code: u.code, label: u.label }));
  }, [stockUnitCode, value]);

  const lockedRows = useMemo(
    () => buildLockedProductConversionRows(companyId, stockUnitCode),
    [companyId, stockUnitCode],
  );

  const rowsToRender = useMemo(
    () => buildProductConversionRowsToRender(companyId, stockUnitCode, value),
    [companyId, stockUnitCode, value],
  );

  const handleAdd = async (payload: {
    primary_qty: number;
    secondary_unit_code: string;
    secondary_qty: number;
  }) => {
    const code = stockUnitCode.trim();
    if (!code) return;
    onChange(
      prepareProductUnitConversionsForPersist(code, [
        ...value,
        {
          company_id: companyId,
          primary_qty: payload.primary_qty,
          primary_unit_code: code,
          secondary_qty: payload.secondary_qty,
          secondary_unit_code: payload.secondary_unit_code,
        },
      ]),
    );
    setDialogOpen(false);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const primaryForDialog = primaryMeta
    ? { code: primaryMeta.code, label: primaryMeta.label }
    : stockUnitCode.trim()
      ? { code: stockUnitCode.trim(), label: stockUnitCode.trim() }
      : null;

  return (
    <>
      <div className={sectionClassName}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Unidade de estoque e conversões
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A unidade escolhida acima é a base do estoque. Abaixo, relacione
              com outras medidas (ex.: 1 garrafa = 750 ml). Várias regras
              permitidas — cada produto tem a sua.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1"
            disabled={
              disabled ||
              !stockUnitCode.trim() ||
              secondaryOptions.length === 0
            }
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Nova conversão
          </Button>
        </div>

        {!stockUnitCode.trim() ? (
          <p className="text-sm text-muted-foreground">
            Escolha a unidade de estoque acima para cadastrar conversões.
          </p>
        ) : rowsToRender.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma conversão cadastrada para este produto.
          </p>
        ) : (
          <ul className="space-y-2">
            {rowsToRender.map((row, index) => {
              const isLocked = isLockedSystemConversionPair(
                row.primary_unit_code,
                row.secondary_unit_code,
              );
              return (
                <li
                  key={row.id ?? `${row.secondary_unit_code}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span>
                    {productConversionRowLabel(row, stockUnitCode)}
                  </span>
                  {isLocked ? (
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Travada
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive"
                      disabled={disabled}
                      onClick={() => removeAt(index - lockedRows.length)}
                      aria-label="Remover conversão"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UnitConversionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        primaryUnit={primaryForDialog}
        secondaryUnits={secondaryOptions}
        onSave={(p) => handleAdd(p)}
        saving={false}
      />
    </>
  );
}

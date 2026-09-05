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
import { cn } from "@/lib/utils";
import { Plus, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

interface ProductUnitConversionsSectionProps {
  companyId: string;
  /** Unidade de estoque do produto (`products.unit`) — principal das conversões. */
  stockUnitCode: string;
  value: ProductUnitConversionDraft[];
  onChange: (next: ProductUnitConversionDraft[]) => void;
  /** Torna a unidade secundária da regra a unidade de estoque (rebase + conversão de quantidades). */
  onPromoteSecondaryToStockUnit?: (
    secondaryUnitCode: string,
  ) => void | Promise<void>;
  disabled?: boolean;
  sectionClassName?: string;
  /** Resumo do produto: título curto, sem texto explicativo longo. */
  compact?: boolean;
  addDialogOpen?: boolean;
  onAddDialogOpenChange?: (open: boolean) => void;
  preferredSecondaryUnit?: string | null;
}

export function ProductUnitConversionsSection({
  companyId,
  stockUnitCode,
  value,
  onChange,
  onPromoteSecondaryToStockUnit,
  disabled,
  sectionClassName = PRODUCT_SHEET_SECTION,
  compact = false,
  addDialogOpen,
  onAddDialogOpenChange,
  preferredSecondaryUnit,
}: ProductUnitConversionsSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const dialogOpen = addDialogOpen ?? uncontrolledOpen;
  const setDialogOpen = onAddDialogOpenChange ?? setUncontrolledOpen;

  const primaryMeta = useMemo(() => {
    const c = stockUnitCode.trim().toLowerCase();
    return SYSTEM_PRODUCT_UNITS.find((u) => u.code.toLowerCase() === c) ?? null;
  }, [stockUnitCode]);

  const secondaryOptions = useMemo(() => {
    const c = stockUnitCode.trim().toLowerCase();
    const used = new Set(
      value.map((v) => v.secondary_unit_code.trim().toLowerCase()),
    );
    const opts = SYSTEM_PRODUCT_UNITS.filter(
      (u) =>
        u.code.toLowerCase() !== c &&
        !used.has(u.code.toLowerCase()) &&
        !isLockedSystemConversionPair(stockUnitCode, u.code),
    ).map((u) => ({ code: u.code, label: u.label }));
    const preferred = preferredSecondaryUnit?.trim().toLowerCase() ?? "";
    if (
      preferred &&
      preferred !== c &&
      !used.has(preferred) &&
      !opts.some((o) => o.code.toLowerCase() === preferred)
    ) {
      const meta = SYSTEM_PRODUCT_UNITS.find(
        (u) => u.code.toLowerCase() === preferred,
      );
      opts.unshift({
        code: preferredSecondaryUnit!.trim(),
        label: meta?.label ?? preferredSecondaryUnit!.trim(),
      });
    }
    return opts;
  }, [stockUnitCode, value, preferredSecondaryUnit]);

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
        <div
          className={cn(
            "mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
            compact && "mb-3",
          )}
        >
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {compact ? "Conversões de unidade" : "Unidade de estoque e conversões"}
            </p>
            {!compact ? (
              <p className="mt-1 text-xs text-muted-foreground">
                A unidade escolhida acima é a base do estoque. Abaixo, relacione
                com outras medidas (ex.: 1 garrafa = 750 ml). Várias regras
                permitidas — cada produto tem a sua.
              </p>
            ) : null}
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
            Adicionar conversão
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
                  <div className="flex shrink-0 items-center gap-0.5">
                    {isLocked ? (
                      <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Travada
                      </span>
                    ) : (
                      <>
                        {onPromoteSecondaryToStockUnit &&
                        row.secondary_unit_code.trim().toLowerCase() !==
                          stockUnitCode.trim().toLowerCase() &&
                        row.primary_unit_code.trim().toLowerCase() ===
                          stockUnitCode.trim().toLowerCase() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 px-2 text-xs"
                            disabled={disabled}
                            onClick={() =>
                              onPromoteSecondaryToStockUnit(
                                row.secondary_unit_code.trim(),
                              )
                            }
                          >
                            <Star className="h-3.5 w-3.5" />
                            Tornar padrão
                          </Button>
                        ) : null}
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
                      </>
                    )}
                  </div>
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
        initialSecondaryUnit={preferredSecondaryUnit}
        onSave={(p) => handleAdd(p)}
        saving={false}
      />
    </>
  );
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UnitConversionDialog } from "@/components/units/UnitConversionDialog";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { cn } from "@/lib/utils";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useProductUnitConversionQuickAdd } from "./useProductUnitConversionQuickAdd";

export interface ProductUnitPickerWithConversionProps {
  companyId: string;
  stockUnitCode: string;
  unitCodes: string[];
  value: string;
  onValueChange: (code: string) => void;
  conversions: ProductUnitConversionDraft[];
  onConversionsChange: (
    next: ProductUnitConversionDraft[],
  ) => void | Promise<void>;
  onSecondaryUnitAdded?: (secondaryUnitCode: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Rótulo extra quando o código é a unidade de estoque (ex.: «(estoque)»). */
  hubUnitCode?: string;
  className?: string;
  triggerClassName?: string;
  triggerId?: string;
}

export function ProductUnitPickerWithConversion({
  companyId,
  stockUnitCode,
  unitCodes,
  value,
  onValueChange,
  conversions,
  onConversionsChange,
  onSecondaryUnitAdded,
  disabled,
  placeholder = "Unidade",
  hubUnitCode,
  className,
  triggerClassName,
  triggerId,
}: ProductUnitPickerWithConversionProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const quickAdd = useProductUnitConversionQuickAdd({
    companyId,
    stockUnitCode,
    conversions,
    onConversionsChange,
    onSecondaryUnitAdded: (code) => {
      onSecondaryUnitAdded?.(code);
      onValueChange(code);
    },
  });

  const hub = (hubUnitCode ?? stockUnitCode).trim().toLowerCase();

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const unique = [
      ...new Set(unitCodes.map((u) => u.trim().toLowerCase())),
    ].filter(Boolean);
    if (!t) return unique;
    return unique.filter((code) => {
      const label = systemUnitLabel(code).toLowerCase();
      return code.includes(t) || label.includes(t);
    });
  }, [unitCodes, q]);

  const selectedLabel = value
    ? value.trim().toLowerCase() === hub
      ? `${systemUnitLabel(value)} (estoque)`
      : systemUnitLabel(value)
    : null;

  const searchActive = q.trim().length > 0;
  const showRegisterInList = quickAdd.canAddConversion && !disabled;

  return (
    <div className={className}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQ("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              triggerClassName,
            )}
          >
            <span className="truncate text-left">
              {selectedLabel ?? placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar unidade..."
                className="h-9 pl-8"
                autoFocus
              />
            </div>
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
            {filtered.map((code) => (
              <button
                key={code}
                type="button"
                className={cn(
                  "w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                  value.trim().toLowerCase() === code && "bg-accent/80",
                )}
                onClick={() => {
                  onValueChange(code);
                  setOpen(false);
                  setQ("");
                }}
              >
                {code === hub
                  ? `${systemUnitLabel(code)} (estoque)`
                  : systemUnitLabel(code)}
              </button>
            ))}
            {filtered.length === 0 && searchActive ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                Nenhuma unidade encontrada.
              </p>
            ) : null}
            {showRegisterInList ? (
              <div className="mt-1 border-t border-border p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
                  disabled={quickAdd.saving}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    quickAdd.setDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  Nova conversão
                </button>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <UnitConversionDialog
        open={quickAdd.dialogOpen}
        onOpenChange={quickAdd.setDialogOpen}
        primaryUnit={quickAdd.primaryForDialog}
        secondaryUnits={quickAdd.secondaryOptions}
        onSave={quickAdd.handleSave}
        saving={quickAdd.saving}
      />
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isLockedSystemConversionPair } from "@/lib/companyUnits/convert";
import {
  buildLockedProductConversionRows,
  buildProductConversionRowsToRender,
  productConversionRowLabel,
} from "@/lib/companyUnits/productConversionRows";
import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";
import { prepareProductUnitConversionsForPersist } from "@/lib/productUnitConversionsService";
import { cn } from "@/lib/utils";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export function MergeProductConversionsEditor({
  companyId,
  productId,
  productName,
  stockUnitCode,
  value,
  onChange,
}: {
  companyId: string;
  productId: string;
  productName: string;
  stockUnitCode: string;
  value: ProductUnitConversionDraft[];
  onChange: (next: ProductUnitConversionDraft[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [secondaryCode, setSecondaryCode] = useState("");
  const [primaryQty, setPrimaryQty] = useState("1");
  const [secondaryQty, setSecondaryQty] = useState("");

  const lockedRows = useMemo(
    () => buildLockedProductConversionRows(companyId, stockUnitCode),
    [companyId, stockUnitCode],
  );

  const rowsToRender = useMemo(
    () => buildProductConversionRowsToRender(companyId, stockUnitCode, value),
    [companyId, stockUnitCode, value],
  );

  const secondaryOptions = useMemo(() => {
    const hub = stockUnitCode.trim().toLowerCase();
    const used = new Set(
      value.map((v) => v.secondary_unit_code.trim().toLowerCase()),
    );
    return SYSTEM_PRODUCT_UNITS.filter(
      (u) =>
        u.code.toLowerCase() !== hub &&
        !used.has(u.code.toLowerCase()) &&
        !isLockedSystemConversionPair(stockUnitCode, u.code),
    );
  }, [stockUnitCode, value]);

  const addConversion = () => {
    const hub = stockUnitCode.trim();
    const p = parseFloat(primaryQty.replace(",", "."));
    const s = parseFloat(secondaryQty.replace(",", "."));
    if (!hub || !secondaryCode || !Number.isFinite(p) || p <= 0 || !Number.isFinite(s) || s <= 0) {
      return;
    }
    onChange(
      prepareProductUnitConversionsForPersist(hub, [
        ...value,
        {
          company_id: companyId,
          product_id: productId,
          primary_qty: p,
          primary_unit_code: hub,
          secondary_qty: s,
          secondary_unit_code: secondaryCode,
        },
      ]),
    );
    setAdding(false);
    setSecondaryCode("");
    setPrimaryQty("1");
    setSecondaryQty("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{productName}</p>
          <p className="text-[0.65rem] text-muted-foreground">
            Unidade de estoque: {stockUnitCode}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          disabled={!stockUnitCode.trim() || secondaryOptions.length === 0}
          onClick={() => {
            setAdding((v) => !v);
            if (!secondaryCode && secondaryOptions[0]) {
              setSecondaryCode(secondaryOptions[0].code);
            }
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Nova
        </Button>
      </div>

      {rowsToRender.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma conversão cadastrada.</p>
      ) : (
        <ul className="space-y-1">
          {rowsToRender.map((row, index) => {
            const locked = isLockedSystemConversionPair(
              row.primary_unit_code,
              row.secondary_unit_code,
            );
            return (
              <li
                key={row.id ?? `${row.secondary_unit_code}-${index}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 text-pretty">
                  {productConversionRowLabel(row, stockUnitCode)}
                </span>
                {locked ? (
                  <span className="shrink-0 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">
                    Travada
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive"
                    aria-label="Remover conversão"
                    onClick={() =>
                      onChange(value.filter((_, i) => i !== index - lockedRows.length))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[0.65rem]">Qtd. ({stockUnitCode})</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={primaryQty}
                onChange={(e) => setPrimaryQty(e.target.value)}
              />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">=</span>
            <div className="space-y-1">
              <Label className="text-[0.65rem]">Qtd. equivalente</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={secondaryQty}
                onChange={(e) => setSecondaryQty(e.target.value)}
              />
            </div>
          </div>
          <Select value={secondaryCode} onValueChange={setSecondaryCode}>
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue placeholder="Unidade equivalente" />
            </SelectTrigger>
            <SelectContent>
              {secondaryOptions.map((u) => (
                <SelectItem key={u.code} value={u.code}>
                  {u.label} ({u.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setAdding(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={
                !secondaryCode ||
                !parseFloat(primaryQty.replace(",", ".")) ||
                !parseFloat(secondaryQty.replace(",", "."))
              }
              onClick={addConversion}
            >
              Adicionar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MergeFactorChoiceList({
  candidates,
  selectedId,
  onSelect,
  manualSelected,
  onSelectManual,
}: {
  candidates: { id: string; label: string; detail: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  manualSelected: boolean;
  onSelectManual: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Usar esta proporção</p>
      {candidates.map((c) => {
        const active = !manualSelected && selectedId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
              active
                ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                : "border-border/80 bg-background hover:bg-muted/40",
            )}
          >
            <span className="text-xs font-medium">{c.label}</span>
            <span className="mt-0.5 text-[0.7rem] text-muted-foreground">
              {c.detail}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onSelectManual}
        className={cn(
          "flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
          manualSelected
            ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
            : "border-border/80 bg-background hover:bg-muted/40",
        )}
      >
        <span className="text-xs font-medium">Informar proporção</span>
        <span className="mt-0.5 text-[0.7rem] text-muted-foreground">
          Digite a equivalência entre as unidades de estoque.
        </span>
      </button>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  formatPackCountExpression,
  formatPackCountQty,
  packCountTotal,
  resolvePackCountContext,
  type PackCountAllowedUnit,
} from "@/lib/inventoryCount/packCountCalculator";
import { ChevronDown, Minus, Package, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function parseStepperValue(raw: string, integer: boolean): number {
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return integer ? Math.floor(n) : n;
}

function PackStepperRow({
  label,
  value,
  integer,
  min,
  onChange,
}: {
  label: string;
  value: number;
  integer: boolean;
  min: number;
  onChange: (n: number) => void;
}) {
  const display =
    integer && Number.isInteger(value)
      ? String(value)
      : formatPackCountQty(value);
  const [draft, setDraft] = useState(display);
  useEffect(() => {
    setDraft(display);
  }, [display]);

  const commitDraft = () => {
    const next = parseStepperValue(draft, integer);
    onChange(next < min ? min : next);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 bg-background text-primary"
          aria-label={`Diminuir ${label}`}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus className="size-4" />
        </Button>
        <Input
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          className="h-10 w-[4.25rem] bg-background px-1 text-center text-base font-bold tabular-nums"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 bg-background text-primary"
          aria-label={`Aumentar ${label}`}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InventoryCountPackCalculator({
  hubUnit,
  allowedUnits,
  onApply,
  onOpenChange,
}: {
  hubUnit: string;
  allowedUnits: PackCountAllowedUnit[];
  onApply: (qty: number, unit: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const ctx = useMemo(
    () => resolvePackCountContext(hubUnit, allowedUnits),
    [hubUnit, allowedUnits],
  );
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState(0);
  const [perBox, setPerBox] = useState(ctx.unitsPerPack);
  const [loose, setLoose] = useState(0);

  const total = packCountTotal({
    boxes,
    perBox,
    loose,
    hubIsPack: ctx.hubIsPack,
  });

  const apply = (next: { boxes: number; perBox: number; loose: number }) => {
    const qty = packCountTotal({
      ...next,
      hubIsPack: ctx.hubIsPack,
    });
    if (qty == null) return;
    onApply(qty, hubUnit);
  };

  const setOpenAndNotify = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpenAndNotify}
      className="mt-4 rounded-xl border border-primary/20 bg-primary/5 text-left"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left hover:bg-primary/10">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
          <Package className="size-4 shrink-0" />
          {ctx.labels.title}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t border-primary/15 px-4 py-3">
          <PackStepperRow
            label={ctx.labels.packs}
            value={boxes}
            integer
            min={0}
            onChange={(n) => {
              setBoxes(n);
              apply({ boxes: n, perBox, loose });
            }}
          />
          <PackStepperRow
            label={ctx.labels.perPack}
            value={perBox}
            integer={Number.isInteger(ctx.unitsPerPack) && Number.isInteger(perBox)}
            min={1}
            onChange={(n) => {
              const next = n <= 0 ? 1 : n;
              setPerBox(next);
              apply({ boxes, perBox: next, loose });
            }}
          />
          <PackStepperRow
            label={ctx.labels.loose}
            value={loose}
            integer
            min={0}
            onChange={(n) => {
              setLoose(n);
              apply({ boxes, perBox, loose: n });
            }}
          />
          <div className="flex items-end justify-between gap-3 border-t border-primary/15 pt-3">
            <p className="text-xs text-muted-foreground">
              {formatPackCountExpression({
                boxes,
                perBox,
                loose,
                hubIsPack: ctx.hubIsPack,
              })}
            </p>
            <p className="text-2xl font-bold tabular-nums text-primary">
              {total == null ? "—" : formatPackCountQty(total)}
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

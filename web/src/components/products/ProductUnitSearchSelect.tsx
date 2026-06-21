import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { isSystemUnitCode } from "@/lib/companyUnits/productUnitOptions";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

export type ProductUnitOption = { value: string; label: string };

function normalizeCustomUnitCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

type ProductUnitSearchSelectProps = {
  value: string;
  options: ProductUnitOption[];
  onSelect: (unitCode: string) => void;
  onCreateUnit: (label: string, code: string) => Promise<void>;
  disabled?: boolean;
  triggerClassName?: string;
  importUnitRawHint?: string | null;
  creating?: boolean;
};

export function ProductUnitSearchSelect({
  value,
  options,
  onSelect,
  onCreateUnit,
  disabled,
  triggerClassName,
  importUnitRawHint,
  creating = false,
}: ProductUnitSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createCode, setCreateCode] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const selectedLabel =
    (options.find((o) => o.value === value)?.label ?? value) || "Selecione";

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(t) ||
        o.value.toLowerCase().includes(t),
    );
  }, [options, search]);

  const createCodeNormalized = normalizeCustomUnitCode(createCode);
  const createCodeValid = createCodeNormalized.length > 0;

  const resetCreate = () => {
    setCreateOpen(false);
    setCreateLabel("");
    setCreateCode("");
  };

  const handleCreate = async () => {
    const label = createLabel.trim();
    if (!label || !createCodeValid) return;
    await onCreateUnit(label, createCodeNormalized);
    resetCreate();
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) {
          setSearch("");
          resetCreate();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-11 w-full justify-between rounded-xl border-border bg-background font-normal shadow-sm",
            triggerClassName,
          )}
        >
          <span className="truncate text-left">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar unidade…"
              className="h-9 pl-8"
              autoFocus
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
          {filtered.length === 0 && !createOpen ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              Nenhuma unidade encontrada.
            </p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                  o.value === value && "bg-accent/80",
                )}
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border p-2">
          {!createOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-full justify-start gap-2 text-primary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Criar unidade
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
              <p className="text-xs font-medium text-foreground">
                Nova unidade
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="unit-create-label" className="text-xs">
                  Nome
                </Label>
                <Input
                  id="unit-create-label"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  placeholder="Ex.: Vidro"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-create-code" className="text-xs">
                  Abreviação
                </Label>
                <Input
                  id="unit-create-code"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder={
                    importUnitRawHint
                      ? `Sugestão XML: ${importUnitRawHint}`
                      : "Ex.: vd"
                  }
                  className="h-9 font-mono"
                />
              </div>
              {importUnitRawHint ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() => {
                    const raw = importUnitRawHint.trim();
                    const code = normalizeCustomUnitCode(raw);
                    setCreateCode(code || raw);
                    if (!createLabel.trim()) setCreateLabel(raw);
                  }}
                >
                  Usar unidade do XML ({importUnitRawHint})
                </Button>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={resetCreate}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={
                    creating || !createLabel.trim() || !createCodeValid
                  }
                  onClick={() => void handleCreate()}
                >
                  {creating ? "Criando…" : "Criar e aplicar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function isLegacyProductUnit(
  unitCode: string,
  knownUnitCodes: Set<string>,
): boolean {
  const u = unitCode.trim().toLowerCase();
  return (
    u.length > 0 &&
    !isSystemUnitCode(u) &&
    !knownUnitCodes.has(u)
  );
}

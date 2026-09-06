import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { isSystemUnitCode } from "@/lib/companyUnits/productUnitOptions";
import { Plus } from "lucide-react";
import { useState } from "react";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createCode, setCreateCode] = useState("");

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
  };

  return (
    <SearchSelect
      value={value}
      onValueChange={onSelect}
      options={options}
      placeholder="Selecione"
      searchPlaceholder="Buscar unidade…"
      emptyMessage="Nenhuma unidade encontrada."
      disabled={disabled}
      triggerClassName={
        triggerClassName ??
        "h-11 rounded-xl border-border bg-background shadow-sm"
      }
      onCreate={(query) => {
        setCreateOpen(true);
        setCreateLabel(query);
        setCreateCode(normalizeCustomUnitCode(query));
      }}
      createLabel={(query) => `Cadastrar unidade «${query}»`}
      keepOpenOnCreate
      footer={
        createOpen ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
            <p className="text-xs font-medium text-foreground">Nova unidade</p>
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
                disabled={creating || !createLabel.trim() || !createCodeValid}
                onClick={() => void handleCreate()}
              >
                {creating ? "Criando…" : "Criar e aplicar"}
              </Button>
            </div>
          </div>
        ) : (
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
        )
      }
    />
  );
}

export function isLegacyProductUnit(
  unitCode: string,
  knownUnitCodes: Set<string>,
): boolean {
  const u = unitCode.trim().toLowerCase();
  return u.length > 0 && !isSystemUnitCode(u) && !knownUnitCodes.has(u);
}

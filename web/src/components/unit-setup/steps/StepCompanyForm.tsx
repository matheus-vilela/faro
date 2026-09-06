import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { maskCpfCnpj } from "@/lib/masks";
import type { EmpresaMap } from "@/types/companySetup";
import { REGIME_TRIBUTARIO_OPTIONS } from "@/types/companySetup";

const REGIME_VALUES = new Set(REGIME_TRIBUTARIO_OPTIONS.map((o) => o.value));

function normalizeRegimeValue(
  raw: EmpresaMap["regime_tributario"],
): string | undefined {
  if (raw == null) return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !REGIME_VALUES.has(n)) return undefined;
  return String(n);
}

function isEmpresaKeyLocked(
  key: keyof EmpresaMap,
  locked: readonly string[] | undefined,
): boolean {
  return !!locked?.includes(key as string);
}

export function StepCompanyForm({
  groupName,
  onGroupNameChange,
  showGroupName,
  empresa,
  onEmpresaChange,
  lockedEmpresaKeys,
  cnpjValidated,
}: {
  groupName: string;
  onGroupNameChange: (v: string) => void;
  showGroupName: boolean;
  empresa: EmpresaMap;
  onEmpresaChange: (patch: Partial<EmpresaMap>) => void;
  lockedEmpresaKeys?: readonly string[];
  cnpjValidated?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showGroupName ? (
        <div className="space-y-2">
          <Label htmlFor="grp">Nome do grupo *</Label>
          <Input
            id="grp"
            placeholder="Ex.: Rede Centro"
            value={groupName}
            onChange={(e) => onGroupNameChange(e.target.value)}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="cnpj">CNPJ *</Label>
        <Input
          id="cnpj"
          className="w-full"
          inputMode="numeric"
          autoComplete="off"
          value={maskCpfCnpj(empresa.cnpj_cpf ?? "")}
          onChange={(e) =>
            onEmpresaChange({
              cnpj_cpf: e.target.value.replace(/\D/g, ""),
            })
          }
        />
      </div>

      {cnpjValidated ? (
        <p className="text-sm text-green-600 dark:text-green-500">
          ✓ Encontramos seu negócio na Receita. Confira os dados abaixo.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Informe o CNPJ e busque na Receita para liberar os demais campos.
        </p>
      )}

      {cnpjValidated ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="nf">Nome fantasia *</Label>
            <Input
              id="nf"
              value={empresa.nome_fantasia ?? ""}
              onChange={(e) =>
                onEmpresaChange({ nome_fantasia: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rz">Razão social *</Label>
            <Input
              id="rz"
              value={empresa.nome_razao_social ?? ""}
              disabled={isEmpresaKeyLocked(
                "nome_razao_social",
                lockedEmpresaKeys,
              )}
              onChange={(e) =>
                onEmpresaChange({ nome_razao_social: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Regime tributário *</Label>
            <SearchSelect
              value={normalizeRegimeValue(empresa.regime_tributario) ?? ""}
              onValueChange={(v) =>
                onEmpresaChange({ regime_tributario: Number(v) })
              }
              options={REGIME_TRIBUTARIO_OPTIONS.map((o) => ({
                value: String(o.value),
                label: o.label,
              }))}
              placeholder="Selecione"
              disabled={isEmpresaKeyLocked(
                "regime_tributario",
                lockedEmpresaKeys,
              )}
              triggerClassName="w-full min-w-0"
              contentClassName="z-[200]"
              listMaxHeightClassName="max-h-[min(280px,50vh)]"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

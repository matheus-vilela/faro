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
import { maskCpfCnpj } from "@/lib/masks";
import type { EmpresaMap } from "@/types/companySetup";
import { REGIME_TRIBUTARIO_OPTIONS } from "@/types/companySetup";
import { Loader2 } from "lucide-react";

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
  cnpjValidating,
  onValidarCnpj,
  cnpjValidated,
}: {
  groupName: string;
  onGroupNameChange: (v: string) => void;
  showGroupName: boolean;
  empresa: EmpresaMap;
  onEmpresaChange: (patch: Partial<EmpresaMap>) => void;
  lockedEmpresaKeys?: readonly string[];
  cnpjValidating?: boolean;
  onValidarCnpj?: () => void;
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
        <div className="flex flex-wrap items-end gap-2">
          <Input
            id="cnpj"
            className="min-w-[12rem] flex-1"
            inputMode="numeric"
            autoComplete="off"
            value={maskCpfCnpj(empresa.cnpj_cpf ?? "")}
            onChange={(e) =>
              onEmpresaChange({
                cnpj_cpf: e.target.value.replace(/\D/g, ""),
              })
            }
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            disabled={cnpjValidating || !onValidarCnpj}
            onClick={() => onValidarCnpj?.()}
          >
            {cnpjValidating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Validando…
              </>
            ) : (
              "Validar"
            )}
          </Button>
        </div>
      </div>

      {!cnpjValidated ? (
        <p className="text-sm text-muted-foreground">
          Valide o CNPJ para liberar os demais campos da empresa.
        </p>
      ) : null}

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
          {/* <div className="space-y-2">
            <Label htmlFor="ie">Inscrição estadual</Label>
            <Input
              id="ie"
              value={empresa.inscricao_estadual ?? ""}
              onChange={(e) =>
                onEmpresaChange({ inscricao_estadual: e.target.value })
              }
            />
          </div> */}
          <div className="space-y-2">
            <Label>Regime tributário *</Label>
            <Select
              value={normalizeRegimeValue(empresa.regime_tributario)}
              onValueChange={(v) =>
                onEmpresaChange({ regime_tributario: Number(v) })
              }
              disabled={isEmpresaKeyLocked(
                "regime_tributario",
                lockedEmpresaKeys,
              )}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={4}
                className="z-[200] max-h-[min(280px,50vh)]"
              >
                {REGIME_TRIBUTARIO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
    </div>
  );
}

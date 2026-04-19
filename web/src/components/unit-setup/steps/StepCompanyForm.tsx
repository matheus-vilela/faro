import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
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

export function StepCompanyForm({
  groupName,
  onGroupNameChange,
  showGroupName,
  empresa,
  onEmpresaChange,
}: {
  groupName: string;
  onGroupNameChange: (v: string) => void;
  showGroupName: boolean;
  empresa: EmpresaMap;
  onEmpresaChange: (patch: Partial<EmpresaMap>) => void;
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
        <Label htmlFor="rz">Razão social *</Label>
        <Input
          id="rz"
          value={empresa.nome_razao_social ?? ""}
          onChange={(e) =>
            onEmpresaChange({ nome_razao_social: e.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nf">Nome fantasia *</Label>
        <Input
          id="nf"
          value={empresa.nome_fantasia ?? ""}
          onChange={(e) => onEmpresaChange({ nome_fantasia: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cnpj">CNPJ *</Label>
        <Input
          id="cnpj"
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
      <div className="space-y-2">
        <Label htmlFor="ie">Inscrição estadual</Label>
        <Input
          id="ie"
          value={empresa.inscricao_estadual ?? ""}
          onChange={(e) =>
            onEmpresaChange({ inscricao_estadual: e.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Regime tributário *</Label>
        <Select
          value={normalizeRegimeValue(empresa.regime_tributario)}
          onValueChange={(v) =>
            onEmpresaChange({ regime_tributario: Number(v) })
          }
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
      <div className="space-y-2">
        <Label htmlFor="em">E-mail *</Label>
        <Input
          id="em"
          type="email"
          value={empresa.email ?? ""}
          onChange={(e) => onEmpresaChange({ email: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tel">Telefone *</Label>
        <Input
          id="tel"
          inputMode="tel"
          value={maskPhone(empresa.telefone ?? "")}
          onChange={(e) =>
            onEmpresaChange({
              telefone: e.target.value.replace(/\D/g, ""),
            })
          }
        />
      </div>
    </div>
  );
}

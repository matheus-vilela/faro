import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FocusNfeMap } from "@/types/companySetup";
import {
  FOCUS_NFE_MODELO_NFCE,
  FOCUS_NFE_MODELO_NFE,
} from "@/types/companySetup";

export function StepFiscalForm({
  focusnfe,
  onChange,
}: {
  focusnfe: FocusNfeMap;
  onChange: (patch: Partial<FocusNfeMap>) => void;
}) {
  const modelo = (focusnfe.modelo ?? "").trim();
  const modeloSelectValue =
    modelo === FOCUS_NFE_MODELO_NFCE || modelo === FOCUS_NFE_MODELO_NFE
      ? modelo
      : undefined;
  const isNfce = modelo === FOCUS_NFE_MODELO_NFCE;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Modelo da nota</Label>
        <Select
          value={modeloSelectValue}
          onValueChange={(v) => onChange({ modelo: v })}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue placeholder="Selecione NFC-e ou NF-e" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            sideOffset={4}
            className="z-[200] max-h-[min(280px,50vh)]"
          >
            <SelectItem value={FOCUS_NFE_MODELO_NFCE}>NFC-e</SelectItem>
            <SelectItem value={FOCUS_NFE_MODELO_NFE}>NF-e</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isNfce ? (
        <p className="text-sm text-muted-foreground">
          Para NFC-e, informe CSC e ID do token em produção e homologação.
        </p>
      ) : modelo === FOCUS_NFE_MODELO_NFE ? (
        <p className="text-sm text-muted-foreground">
          Para NF-e, os campos de token NFC-e ficam desabilitados.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cscP">CSC NFC-e produção</Label>
          <Input
            id="cscP"
            disabled={!isNfce}
            value={focusnfe.csc_nfce_producao ?? ""}
            onChange={(e) =>
              onChange({ csc_nfce_producao: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tokP">ID token NFC-e produção</Label>
          <Input
            id="tokP"
            disabled={!isNfce}
            value={focusnfe.id_token_nfce_producao ?? ""}
            onChange={(e) =>
              onChange({ id_token_nfce_producao: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cscH">CSC NFC-e homologação</Label>
          <Input
            id="cscH"
            disabled={!isNfce}
            value={focusnfe.csc_nfce_homologacao ?? ""}
            onChange={(e) =>
              onChange({ csc_nfce_homologacao: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tokH">ID token NFC-e homologação</Label>
          <Input
            id="tokH"
            disabled={!isNfce}
            value={focusnfe.id_token_nfce_homologacao ?? ""}
            onChange={(e) =>
              onChange({ id_token_nfce_homologacao: e.target.value })
            }
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="serie">Série</Label>
          <Input
            id="serie"
            value={focusnfe.serie ?? ""}
            onChange={(e) => onChange({ serie: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prox">Próximo número NFC-e</Label>
          <Input
            id="prox"
            value={focusnfe.proximoNumeroNfce ?? ""}
            onChange={(e) =>
              onChange({ proximoNumeroNfce: e.target.value })
            }
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="th">Token homologação (geral)</Label>
          <Input
            id="th"
            value={focusnfe.token_homologacao ?? ""}
            onChange={(e) =>
              onChange({ token_homologacao: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tp">Token produção (geral)</Label>
          <Input
            id="tp"
            value={focusnfe.token_producao ?? ""}
            onChange={(e) => onChange({ token_producao: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

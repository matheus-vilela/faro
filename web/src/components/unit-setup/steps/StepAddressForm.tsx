import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskCep } from "@/lib/masks";
import type { EnderecoPrincipalMap } from "@/types/companySetup";
import { Loader2 } from "lucide-react";

function isEndLocked(
  key: keyof EnderecoPrincipalMap,
  locked: readonly string[] | undefined,
): boolean {
  return !!locked?.includes(key as string);
}

export function StepAddressForm({
  endereco,
  onEnderecoChange,
  cepLoading,
  cepError,
  onCepBlur,
  lockedEnderecoKeys,
}: {
  endereco: EnderecoPrincipalMap;
  onEnderecoChange: (patch: Partial<EnderecoPrincipalMap>) => void;
  cepLoading: boolean;
  cepError: string | null;
  onCepBlur: () => void;
  lockedEnderecoKeys?: readonly string[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cep">CEP</Label>
        <div className="flex gap-2">
          <Input
            id="cep"
            inputMode="numeric"
            value={maskCep(endereco.cep ?? "")}
            disabled={isEndLocked("cep", lockedEnderecoKeys)}
            onChange={(e) =>
              onEnderecoChange({ cep: e.target.value.replace(/\D/g, "") })
            }
            onBlur={onCepBlur}
            className="max-w-[11rem]"
          />
          {cepLoading ? (
            <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />
          ) : null}
        </div>
        {cepError ? (
          <p className="text-sm text-destructive">{cepError}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="log">Logradouro</Label>
        <Input
          id="log"
          value={endereco.logradouro ?? ""}
          disabled={isEndLocked("logradouro", lockedEnderecoKeys)}
          onChange={(e) => onEnderecoChange({ logradouro: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="num">Número</Label>
          <Input
            id="num"
            value={endereco.numero ?? ""}
            disabled={isEndLocked("numero", lockedEnderecoKeys)}
            onChange={(e) => onEnderecoChange({ numero: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="comp">Complemento</Label>
          <Input
            id="comp"
            value={endereco.complemento ?? ""}
            disabled={isEndLocked("complemento", lockedEnderecoKeys)}
            onChange={(e) => onEnderecoChange({ complemento: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bairro">Bairro</Label>
        <Input
          id="bairro"
          value={endereco.bairro ?? ""}
          disabled={isEndLocked("bairro", lockedEnderecoKeys)}
          onChange={(e) => onEnderecoChange({ bairro: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mun">Cidade</Label>
          <Input
            id="mun"
            value={endereco.municipio ?? ""}
            disabled={isEndLocked("municipio", lockedEnderecoKeys)}
            onChange={(e) => onEnderecoChange({ municipio: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="uf">UF</Label>
          <Input
            id="uf"
            maxLength={2}
            value={endereco.uf ?? ""}
            disabled={isEndLocked("uf", lockedEnderecoKeys)}
            onChange={(e) =>
              onEnderecoChange({
                uf: e.target.value.toUpperCase().slice(0, 2),
              })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ibge">IBGE da cidade</Label>
        <Input
          id="ibge"
          inputMode="numeric"
          value={endereco.ibge_cidade ?? ""}
          disabled={isEndLocked("ibge_cidade", lockedEnderecoKeys)}
          onChange={(e) => onEnderecoChange({ ibge_cidade: e.target.value })}
        />
      </div>
    </div>
  );
}

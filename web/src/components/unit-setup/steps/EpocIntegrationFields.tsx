import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import type { EpocValidateLoginErrorCode } from "@/lib/setup/epocStep3ValidationGate";
import type { SetupEpocState } from "@/types/companySetup";

export function EpocIntegrationFields({
  epoc,
  onEpocChange,
  validationError,
}: {
  epoc: SetupEpocState | undefined;
  onEpocChange: (patch: Partial<SetupEpocState>) => void;
  validationError?: {
    message: string;
    errorCode: EpocValidateLoginErrorCode | string;
  } | null;
}) {
  const enabled = epoc?.enabled ?? false;

  const patchFields = (patch: Partial<SetupEpocState>) => {
    if (
      patch.password !== undefined &&
      patch.password &&
      patch.password.length > 0
    ) {
      onEpocChange({ ...patch, password_on_server: false });
      return;
    }
    onEpocChange(patch);
  };

  return (
    <div className="space-y-5 rounded-lg border border-border/80 bg-muted/15 p-4 sm:p-5">
      {validationError ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-4 text-sm"
        >
          <p className="font-semibold text-destructive">
            Falha ao validar acesso ao EPOC
          </p>
          <p className="text-muted-foreground">
            Não foi possível confirmar a conexão com o EPOC. Revise os dados
            abaixo e tente novamente.
          </p>
          {validationError.message ? (
            <p className="text-foreground/90">{validationError.message}</p>
          ) : null}
          <ul className="list-inside list-disc space-y-1.5 text-muted-foreground">
            <li>Verifique se a URL do EPOC está correta.</li>
            <li>Confirme se o login e a senha estão corretos.</li>
            <li>Verifique se o servidor do EPOC está disponível.</li>
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-3">
        <div>
          <Label htmlFor="pdv-epoc-enabled" className="text-sm font-medium">
            Integração ativa
          </Label>
          <p className="text-xs text-muted-foreground">
            Quando ativo, o Faro usa estas credenciais na rotina diária.
          </p>
        </div>
        <Switch
          id="pdv-epoc-enabled"
          checked={enabled}
          onCheckedChange={(v) => patchFields({ enabled: v })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pdv-epoc-base-url">URL base (portal EPOC)</Label>
        <Input
          id="pdv-epoc-base-url"
          type="url"
          placeholder="https://… ou http://…:porta"
          value={epoc?.base_url ?? ""}
          onChange={(e) => patchFields({ base_url: e.target.value })}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pdv-epoc-user">Usuário</Label>
          <Input
            id="pdv-epoc-user"
            autoComplete="username"
            value={epoc?.username ?? ""}
            onChange={(e) => patchFields({ username: e.target.value })}
            placeholder="Usuário no portal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pdv-epoc-pass">Senha</Label>
          <PasswordInput
            id="pdv-epoc-pass"
            autoComplete="current-password"
            value={epoc?.password ?? ""}
            onChange={(e) => patchFields({ password: e.target.value })}
            placeholder={
              epoc?.password_on_server
                ? "Deixe em branco para manter a atual"
                : "Senha"
            }
          />
        </div>
      </div>
    </div>
  );
}

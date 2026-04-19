import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import type { SetupEpocState } from "@/types/companySetup";
import { cn } from "@/lib/utils";

export function StepEpocForm({
  epoc,
  onEpocChange,
  onPickExcel,
}: {
  epoc: SetupEpocState | undefined;
  onEpocChange: (patch: Partial<SetupEpocState>) => void;
  onPickExcel: (file: File) => void;
}) {
  const mode = epoc?.mode ?? "undecided";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        O estabelecimento utilizará integração com EPOC?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={mode === "no" ? "default" : "outline"}
          onClick={() => onEpocChange({ mode: "no" })}
        >
          Não
        </Button>
        <Button
          type="button"
          variant={mode === "credentials" ? "default" : "outline"}
          onClick={() => onEpocChange({ mode: "credentials" })}
        >
          Sim — credenciais
        </Button>
        <Button
          type="button"
          variant={mode === "excel" ? "default" : "outline"}
          onClick={() => onEpocChange({ mode: "excel" })}
        >
          Sim — importar Excel
        </Button>
      </div>

      {mode === "credentials" ? (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-2">
            <Label htmlFor="epoc-user">Usuário</Label>
            <Input
              id="epoc-user"
              value={epoc?.username ?? ""}
              onChange={(e) => onEpocChange({ username: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="epoc-pass">Senha</Label>
            <PasswordInput
              id="epoc-pass"
              value={epoc?.password ?? ""}
              onChange={(e) => onEpocChange({ password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="epoc-url">URL base (opcional)</Label>
            <Input
              id="epoc-url"
              value={epoc?.base_url ?? ""}
              onChange={(e) => onEpocChange({ base_url: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="epoc-filial">Código filial (opcional)</Label>
            <Input
              id="epoc-filial"
              value={epoc?.codigo_filial ?? ""}
              onChange={(e) => onEpocChange({ codigo_filial: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      {mode === "excel" ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8",
          )}
        >
          <label className="cursor-pointer text-sm font-medium text-primary underline">
            Selecionar planilha Excel
            <input
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickExcel(f);
              }}
            />
          </label>
          {epoc?.excel_storage_path ? (
            <p className="text-xs text-muted-foreground">Arquivo associado</p>
          ) : null}
        </div>
      ) : null}

      {mode === "no" ? (
        <p className="text-sm text-muted-foreground">
          Esta etapa será marcada como concluída sem integração EPOC.
        </p>
      ) : null}
    </div>
  );
}

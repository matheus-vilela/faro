import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SetupEpocState } from "@/types/companySetup";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

export function StepPdvForm({
  epoc,
  onEpocChange,
}: {
  epoc: SetupEpocState | undefined;
  onEpocChange: (patch: Partial<SetupEpocState>) => void;
}) {
  const mode = epoc?.mode ?? "undecided";
  const enabled = epoc?.enabled ?? false;
  const [accordionOpen, setAccordionOpen] = useState(mode === "credentials");

  useEffect(() => {
    if (mode === "credentials") setAccordionOpen(true);
  }, [mode]);

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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Conecte o ponto de venda (PDV) desta unidade ao Faro para importar
        vendas e manter os dados alinhados. Indique se há integração com algum
        PDV ou se prefere seguir sem essa conexão.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={mode === "no" ? "default" : "outline"}
          onClick={() => onEpocChange({ mode: "no" })}
        >
          Não utilizo
        </Button>
        <Button
          type="button"
          variant={mode === "credentials" ? "default" : "outline"}
          onClick={() =>
            onEpocChange({
              mode: "credentials",
              enabled: epoc?.enabled ?? true,
            })
          }
        >
          Utilizo PDV
        </Button>
      </div>

      {mode === "credentials" ? (
        <Collapsible open={accordionOpen} onOpenChange={setAccordionOpen}>
          <Card
            className={cn(
              "overflow-hidden transition-shadow",
              enabled
                ? "border-emerald-500/35 ring-1 ring-emerald-500/20"
                : "border-border/80",
            )}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-4 p-5 text-left transition-colors",
                  "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-sm font-bold tracking-tight",
                    enabled
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  E
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold tracking-tight text-foreground">
                    EPOC
                  </p>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    URL, usuário, senha e filial. O Faro importa as receitas de
                    vendas após o login no portal.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {enabled ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                        aria-hidden
                      />
                      Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span
                        className="h-2 w-2 rounded-full bg-muted-foreground/50"
                        aria-hidden
                      />
                      Inativo
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
                      accordionOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </div>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="space-y-5 border-t border-border/80 px-5 py-5">
                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-3">
                  <div>
                    <Label
                      htmlFor="pdv-epoc-enabled"
                      className="text-sm font-medium"
                    >
                      Integração ativa
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Quando ativo, o Faro usa estas credenciais na rotina
                      diária.
                    </p>
                  </div>
                  <Switch
                    id="pdv-epoc-enabled"
                    checked={enabled}
                    onCheckedChange={(v) => patchFields({ enabled: v })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pdv-epoc-base-url">
                    URL base (portal EPOC)
                  </Label>
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
                      onChange={(e) =>
                        patchFields({ username: e.target.value })
                      }
                      placeholder="Usuário no portal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pdv-epoc-pass">Senha</Label>
                    <PasswordInput
                      id="pdv-epoc-pass"
                      autoComplete="current-password"
                      value={epoc?.password ?? ""}
                      onChange={(e) =>
                        patchFields({ password: e.target.value })
                      }
                      placeholder={
                        epoc?.password_on_server
                          ? "Deixe em branco para manter a atual"
                          : "Senha"
                      }
                    />
                  </div>
                  {/* <div className="space-y-2">
                    <Label htmlFor="pdv-epoc-filial">Código da filial</Label>
                    <Input
                      id="pdv-epoc-filial"
                      value={epoc?.codigo_filial ?? ""}
                      onChange={(e) =>
                        patchFields({ codigo_filial: e.target.value })
                      }
                      placeholder="Ex.: 123A (NaoMenu); vazio = 123A"
                    />
                  </div> */}
                  {/* <div className="space-y-2">
                    <Label>Ambiente</Label>
                    <Select
                      value={epoc?.ambiente ?? "producao"}
                      onValueChange={(v) =>
                        patchFields({ ambiente: v as EpocAmbiente })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4} className="z-200">
                        <SelectItem value="producao">Produção</SelectItem>
                        <SelectItem value="homologacao">Homologação</SelectItem>
                      </SelectContent>
                    </Select>
                  </div> */}
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}

      {mode === "no" ? (
        <p className="text-sm text-muted-foreground">
          Esta etapa será marcada como concluída sem integração com PDV.
        </p>
      ) : null}
    </div>
  );
}

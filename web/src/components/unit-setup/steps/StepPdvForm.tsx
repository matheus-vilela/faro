import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePdvOption } from "@/lib/setup/validation";
import { cn } from "@/lib/utils";
import type { EpocValidateLoginErrorCode } from "@/lib/setup/epocStep3ValidationGate";
import type { PdvSalesOption, SetupEpocState } from "@/types/companySetup";
import { Check, NotebookPen, Plug, Store } from "lucide-react";
import { EpocIntegrationFields } from "./EpocIntegrationFields";

const PDV_OPTIONS: {
  option: PdvSalesOption;
  title: string;
  description: string;
  icon: typeof Plug;
}[] = [
  {
    option: "epoc",
    title: "Epoc",
    description: "Integração automática de vendas via portal Epoc.",
    icon: Plug,
  },
  {
    option: "other_system",
    title: "Outro sistema",
    description: "Informe qual sistema você usa hoje.",
    icon: Store,
  },
  {
    option: "no_system",
    title: "Não utilizo sistema (Caderno/Maquininha)",
    description: "Siga sem conectar um PDV agora.",
    icon: NotebookPen,
  },
];

export function StepPdvForm({
  epoc,
  onEpocChange,
  onPdvOptionChange,
  validationError,
}: {
  epoc: SetupEpocState | undefined;
  onEpocChange: (patch: Partial<SetupEpocState>) => void;
  onPdvOptionChange: (option: PdvSalesOption) => void;
  validationError?: {
    message: string;
    errorCode: EpocValidateLoginErrorCode | string;
  } | null;
}) {
  const selectedOption = resolvePdvOption(epoc);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {PDV_OPTIONS.map((opt) => {
          const selected = selectedOption === opt.option;
          const Icon = opt.icon;
          return (
            <Card
              key={opt.option}
              className={cn(
                "overflow-hidden transition-shadow",
                selected
                  ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                  : "border-border/80",
              )}
            >
              <button
                type="button"
                onClick={() => onPdvOptionChange(opt.option)}
                className={cn(
                  "flex w-full items-start gap-4 p-4 text-left transition-colors sm:p-5",
                  "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-pressed={selected}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground sm:text-base">
                    {opt.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                {selected ? (
                  <Check
                    className="h-5 w-5 shrink-0 text-primary"
                    aria-hidden
                  />
                ) : null}
              </button>
            </Card>
          );
        })}
      </div>

      {selectedOption === "epoc" ? (
        <EpocIntegrationFields
          epoc={epoc}
          onEpocChange={onEpocChange}
          validationError={validationError}
        />
      ) : null}

      {selectedOption === "other_system" ? (
        <div className="space-y-2 rounded-lg border border-border/80 bg-muted/15 p-4 sm:p-5">
          <Label htmlFor="pdv-other-system-name">
            Qual sistema você utiliza?
          </Label>
          <Input
            id="pdv-other-system-name"
            value={epoc?.other_system_name ?? ""}
            onChange={(e) =>
              onEpocChange({ other_system_name: e.target.value })
            }
            placeholder="Digite o nome do sistema"
            autoComplete="off"
          />
        </div>
      ) : null}

      {selectedOption === "no_system" ? (
        <p className="text-sm text-muted-foreground">
          Você pode avançar sem conectar um ponto de venda agora. Esta etapa
          será marcada como concluída.
        </p>
      ) : null}
    </div>
  );
}

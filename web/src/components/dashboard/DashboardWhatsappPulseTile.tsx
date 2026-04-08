import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getWhatsappAgentDisplayLabel } from "@/lib/whatsappAgentDisplay";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";

const shell = cn(
  "rounded-xl border shadow-sm",
  "border-[#25D366]/35 bg-linear-to-br from-[#25D366]/12 to-[#DCF8C6]/25",
  "dark:border-emerald-500/40 dark:from-emerald-500/15 dark:to-emerald-950/40",
);

/**
 * Telas &lt; lg: card em faixa — número com quebra de linha, ações largas.
 * lg+: tile compacto alinhado aos outros pulsos.
 */
export function DashboardWhatsappPulseTile() {
  const label = getWhatsappAgentDisplayLabel();

  return (
    <div className={cn(shell, "min-w-0")}>
      {/* Modelo compacto — lg+ */}
      <div className="flex flex-col justify-between gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                "bg-[#25D366]/20 text-[#075E54] dark:bg-emerald-500/25 dark:text-emerald-100",
              )}
            >
              <MessageCircle className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#128C7E] dark:text-emerald-300/90">
                Agente WhatsApp
              </p>
              <p
                className={cn(
                  "mt-0.5 wrap-anywhere font-mono text-sm font-bold leading-snug text-[#075E54] sm:text-base",
                  "dark:text-emerald-50",
                )}
                title={label}
              >
                {label}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs text-[#128C7E] hover:bg-[#25D366]/15 hover:text-[#075E54] dark:text-emerald-300"
            asChild
          >
            <Link to="/app/configuracoes/whatsapp">
              Info
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="min-w-0 max-w-48 text-[11px] leading-snug text-[#075E54]/85 dark:text-emerald-200/80 xl:max-w-none">
            Comandos com IA
          </p>
        </div>
      </div>
    </div>
  );
}

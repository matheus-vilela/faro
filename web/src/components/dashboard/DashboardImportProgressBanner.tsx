import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Archive, ArrowRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

export function DashboardImportProgressBanner({
  loading,
  activeImportFiles,
  activeImportPercent,
}: {
  loading: boolean;
  activeImportFiles: number;
  activeImportPercent: number;
}) {
  const hasActiveImport = activeImportFiles > 0;
  const percent = Math.max(0, Math.min(100, activeImportPercent));

  return (
    <Card className="border-2 border-amber-500/50 bg-linear-to-r from-amber-500/20 via-orange-500/15 to-rose-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/30 text-amber-900 ring-1 ring-amber-700/20 dark:text-amber-200">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Archive className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900/80 dark:text-amber-100/80">
                Importacao XML
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {hasActiveImport
                  ? `${activeImportFiles} arquivo(s) em processamento`
                  : "Nenhum lote em processamento agora"}
              </h3>
              <p className="mt-1 text-sm font-medium text-amber-950/90 dark:text-amber-100/90">
                Progresso atual: {loading ? "carregando..." : `${percent}%`}
              </p>
            </div>
          </div>

          <Button size="sm" className="shrink-0" asChild>
            <Link to="/app/importacoes">
              Abrir central de importacoes
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-amber-950/15 dark:bg-amber-100/20">
          <div
            className="h-full rounded-full bg-linear-to-r from-amber-500 to-orange-500 transition-all"
            style={{ width: `${loading ? 20 : percent}%` }}
            aria-hidden
          />
        </div>
      </CardContent>
    </Card>
  );
}

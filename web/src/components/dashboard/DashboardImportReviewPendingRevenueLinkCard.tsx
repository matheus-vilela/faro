import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  dashboardImportReviewFinalizeRecipeProductSales,
  fetchDashboardImportReviewPendingRevenueLink,
  type DashboardPendingRevenueLinkRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Inbox, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/**
 * Etapa 2: após a ficha ter ingredientes, o utilizador liga vendas históricas (product_sale)
 * ao modo recipe_sale. Só aparece quando o passo 1 gravou `revenue_link: pending` na revisão.
 */
export function DashboardImportReviewPendingRevenueLinkCard({
  companyId,
  refreshSignal = 0,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal?: number;
  onPipelineChange?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardPendingRevenueLinkRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] =
    useState<DashboardPendingRevenueLinkRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { rows: next, error: err } =
      await fetchDashboardImportReviewPendingRevenueLink(supabase, companyId);
    setLoading(false);
    if (err) {
      setError(err);
      setRows([]);
      return;
    }
    setRows(next);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const runFinalize = async () => {
    if (!confirmRow) return;
    const pid = confirmRow.product_id;
    setBusyId(pid);
    const res = await dashboardImportReviewFinalizeRecipeProductSales(
      supabase,
      companyId,
      pid,
    );
    setBusyId(null);
    setConfirmRow(null);
    if (!res.ok) {
      toast.error(
        res.error ??
          "Nenhum lançamento foi alterado. Verifique a ficha e tente novamente.",
      );
      return;
    }
    toast.success(
      res.migrated_entries != null && res.migrated_entries > 0
        ? `${res.migrated_entries} lançamento(s) de venda associados à ficha técnica.`
        : "Nenhuma venda pendente em modo produto; estado atualizado.",
    );
    onPipelineChange?.();
    void load();
  };

  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      <AlertDialog
        open={!!confirmRow}
        onOpenChange={(o) => !o && setConfirmRow(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar vendas à ficha técnica?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-pretty">
              <span>
                Os lançamentos de receita ainda em modo{" "}
                <strong className="text-foreground">venda de produto</strong>{" "}
                para{" "}
                <strong className="text-foreground">{confirmRow?.name}</strong>{" "}
                passarão a{" "}
                <strong className="text-foreground">venda por receita</strong>,
                usando a ficha já cadastrada. As movimentações de estoque já
                registadas{" "}
                <strong className="text-foreground">
                  não são apagadas nem recalculadas
                </strong>
                .
              </span>
              <span className="block text-muted-foreground">
                Confirme apenas depois de validar os insumos da receita em
                Produtos → Receitas.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void runFinalize();
              }}
              disabled={!!busyId}
            >
              {busyId ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A migrar…
                </>
              ) : (
                "Ligar vendas à ficha"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-emerald-500/20 bg-gradient-to-br from-card to-emerald-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                <Link2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Etapa 2: vendas ainda como produto (pós-ficha)
                </CardTitle>
                <CardDescription className="text-pretty">
                  Após confirmar o item como ficha técnica e incluir{" "}
                  <strong>pelo menos um insumo</strong> na receita, pode
                  associar aqui os lançamentos de venda importados que ainda
                  estavam no modo produto. Ação explícita — nada corre em
                  segundo plano.
                </CardDescription>
              </div>
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
                rows.length > 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                  : "border-muted text-muted-foreground",
              )}
              aria-live="polite"
            >
              {loading ? "…" : rows.length}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />A verificar filas…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-50" />
              <p>Nada pendente nesta etapa.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.product_id}
                  className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.pending_sales_count} venda(s) ainda em modo produto
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === r.product_id}
                      onClick={() => setConfirmRow(r)}
                    >
                      Ligar vendas à ficha
                    </Button>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link to="/app/produtos?estoque=receitas">
                        Abrir receitas
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

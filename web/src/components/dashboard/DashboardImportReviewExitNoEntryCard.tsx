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
  dashboardImportReviewConfirmOutboundAsRecipe,
  dashboardImportReviewSetResolution,
  fetchDashboardImportReviewExitNoEntry,
  type DashboardImportReviewRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChefHat, Inbox, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export function DashboardImportReviewExitNoEntryCard({
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
  const [rows, setRows] = useState<DashboardImportReviewRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmProduct, setConfirmProduct] = useState<DashboardImportReviewRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { rows: next, error: err } = await fetchDashboardImportReviewExitNoEntry(
      supabase,
      companyId,
    );
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

  const dismiss = async (productId: string) => {
    setBusyId(productId);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId,
      bucket: "EXIT_NO_ENTRY",
      resolution: "DISMISSED",
    });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível dispensar.");
      return;
    }
    toast.success("Item dispensado desta fila.");
    void load();
  };

  const runConfirm = async () => {
    if (!confirmProduct) return;
    const pid = confirmProduct.product_id;
    setBusyId(pid);
    const res = await dashboardImportReviewConfirmOutboundAsRecipe(supabase, companyId, pid);
    setBusyId(null);
    if (!res.ok) {
      toast.error(
        res.error ??
          "O cadastro atual foi mantido. Ajuste o item em Produtos se necessário e tente de novo.",
      );
      return;
    }
    toast.success(
      "Ficha criada e produto marcado como controlado por receita. Cadastre insumos em Receitas; " +
        "depois use o cartão «Etapa 2» para associar vendas importadas à ficha, se aplicável.",
    );
    setConfirmProduct(null);
    void load();
    onPipelineChange?.();
  };

  return (
    <>
      <AlertDialog open={!!confirmProduct} onOpenChange={(o) => !o && setConfirmProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar como ficha técnica?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-pretty">
              <span>
                Esta ação só ocorre porque você confirmou. Será criada uma receita (ficha técnica)
                tipo preparo ligada ao produto{" "}
                <strong className="text-foreground">{confirmProduct?.name}</strong>, o produto
                passará a ser tratado como{" "}
                <strong className="text-foreground">controlado por receita</strong> e o item sairá
                desta fila.
              </span>
              <span className="block">
                Nenhum lançamento de estoque existente é apagado. Se algo falhar, o cadastro
                permanece como está.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runConfirm();
              }}
              disabled={!!busyId}
            >
              {busyId ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processando…
                </>
              ) : (
                "Confirmar conversão"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-violet-500/20 bg-gradient-to-br from-card to-violet-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-800 dark:text-violet-300">
                <ChefHat className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Itens importados com saída e sem entrada
                </CardTitle>
                <CardDescription className="text-pretty">
                  Produtos com <strong>baixa por venda</strong> (receita / EPOC importada) e sem compra
                  correspondente no histórico. São os principais <strong>candidatos a ficha técnica</strong>{" "}
                  (produto de venda preparado internamente) — a conversão só ocorre com a sua confirmação.
                </CardDescription>
              </div>
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
                rows.length > 0
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100"
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
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando revisão pós-importação…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-50" />
              <p>Nenhum item nesta fila no momento.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.slice(0, 8).map((r) => (
                <li
                  key={r.product_id}
                  className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Saldo atual:{" "}
                      {Number(r.current_quantity).toLocaleString("pt-BR", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {r.unit}
                      {r.priority_epoc ? (
                        <span className="ml-2 rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-900 dark:text-violet-200">
                          EPOC / CSV
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === r.product_id}
                      onClick={() => setConfirmProduct(r)}
                    >
                      Confirmar como ficha técnica
                    </Button>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link to="/app/produtos?estoque=receitas">Abrir receitas</Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={busyId === r.product_id}
                      onClick={() => void dismiss(r.product_id)}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Dispensar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && rows.length > 8 ? (
            <p className="text-xs text-muted-foreground">
              Lista truncada: mostrando 8 de {rows.length}. Os demais permanecem na fila até
              revisão ou dispensa.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

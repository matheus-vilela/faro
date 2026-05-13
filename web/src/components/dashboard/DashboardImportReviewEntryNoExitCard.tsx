import { DashboardImportReviewProductCadastroModal } from "@/components/dashboard/DashboardImportReviewProductCadastroModal";
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dashboardImportReviewSetResolution,
  fetchDashboardImportReviewEntryNoExit,
  type DashboardImportReviewRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ArrowRight, Inbox, Loader2, Package, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function DashboardImportReviewEntryNoExitCard({
  companyId,
  refreshSignal = 0,
}: {
  companyId: string;
  refreshSignal?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardImportReviewRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cadastroProductId, setCadastroProductId] = useState<string | null>(null);
  const [recipeModalProductId, setRecipeModalProductId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { rows: next, error: err } = await fetchDashboardImportReviewEntryNoExit(
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
      bucket: "ENTRY_NO_EXIT",
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

  const openRecipeFlow = async (productId: string) => {
    setBusyId(productId);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId,
      bucket: "ENTRY_NO_EXIT",
      resolution: "LINK_RECIPE_STARTED",
    });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível registrar o fluxo.");
      return;
    }
    void load();
    setRecipeModalProductId(productId);
  };

  return (
    <>
    <DashboardImportReviewProductCadastroModal
      companyId={companyId}
      productId={cadastroProductId}
      open={cadastroProductId !== null}
      onOpenChange={(o) => {
        if (!o) setCadastroProductId(null);
      }}
      onSaved={() => void load()}
    />
    <Dialog
      open={recipeModalProductId !== null}
      onOpenChange={(o) => {
        if (!o) setRecipeModalProductId(null);
      }}
    >
      <DialogContent className="top-[5%] max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl translate-y-0 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Ficha técnica</DialogTitle>
          <DialogDescription>
            Escolha uma ficha na lista ou crie uma nova. O produto desta fila entra como saída (se a ficha
            ainda não tiver produto de saída) ou como novo ingrediente.
          </DialogDescription>
        </DialogHeader>
        {recipeModalProductId ? (
          <EstoqueReceitasPanel
            key={recipeModalProductId}
            companyId={companyId}
            prefillNewRecipeOutputProductId={recipeModalProductId}
            prefillNewRecipeAutoOpen={false}
            onStockChanged={() => void load()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
    <Card className="border-sky-500/20 bg-gradient-to-br from-card to-sky-500/5">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-800 dark:text-sky-300">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg leading-snug">
                Itens importados com entrada e sem saída
              </CardTitle>
              <CardDescription className="text-pretty">
                Produtos que <strong>entraram</strong> em stock (compra / NF-e) e ainda não tiveram
                baixa por venda no período analisado. Na prática costumam ser <strong>insumos</strong>{" "}
                ou itens que vão para uma <strong>ficha técnica</strong> — nada muda sozinho; use as
                ações ou ajuste o cadastro se o vínculo estiver errado.
              </CardDescription>
            </div>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
              rows.length > 0
                ? "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100"
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
                    Estoque: {Number(r.current_quantity).toLocaleString("pt-BR", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {r.unit}
                    {r.priority_import ? (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-900 dark:text-amber-200">
                        Prioridade importação
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setCadastroProductId(r.product_id)}
                  >
                    Ajustar cadastro
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={busyId === r.product_id}
                    onClick={() => void openRecipeFlow(r.product_id)}
                  >
                    Criar / vincular ficha técnica
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
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
            Lista truncada: mostrando 8 de {rows.length}. Os demais permanecem na fila até revisão
            ou dispensa.
          </p>
        ) : null}
      </CardContent>
    </Card>
    </>
  );
}

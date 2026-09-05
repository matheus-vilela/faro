import { RecipeProductionSummary } from "@/components/estoque/RecipeProductionSummary";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  produceErrorMessage,
  produceIntermediateProduct,
} from "@/lib/productIntermediate";
import {
  formatProductionQty,
  recipeProductionPreview,
  type RecipeProductionIngredientInput,
} from "@/lib/recipeProductionPreview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Factory, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export function RecipeProducePanel({
  companyId,
  mode,
  outputProductId,
  outputName,
  outputUnit,
  batchYield,
  ingredients,
  recipeId,
  className,
  onProduced,
}: {
  companyId: string;
  mode: "produce" | "prepare";
  outputProductId: string;
  outputName: string;
  outputUnit: string;
  batchYield: number;
  ingredients: RecipeProductionIngredientInput[];
  recipeId?: string | null;
  className?: string;
  onProduced?: () => void;
}) {
  const [batchesRaw, setBatchesRaw] = useState("1");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMemo(
    () =>
      recipeProductionPreview({
        batchesRaw,
        batchYield,
        outputName,
        outputUnit,
        ingredients,
      }),
    [batchesRaw, batchYield, ingredients, outputName, outputUnit],
  );

  const run = async () => {
    if (!preview) {
      toast.error("Informe quantas receitas vai produzir.");
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    if (mode === "produce") {
      if (!outputProductId) {
        setBusy(false);
        toast.error("Produto de saída não encontrado.");
        return;
      }
      const res = await produceIntermediateProduct(
        companyId,
        outputProductId,
        preview.outputQty,
      );
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error ?? produceErrorMessage(undefined));
        return;
      }
      toast.success(
        `Produção registrada: +${formatProductionQty(preview.outputQty)} ${preview.outputUnit}. Insumos baixados.`,
      );
      onProduced?.();
      return;
    }

    if (!recipeId) {
      setBusy(false);
      toast.error("Receita não encontrada.");
      return;
    }
    const { data, error } = await supabase.rpc("consume_recipe_stock", {
      p_recipe_id: recipeId,
      p_portions: preview.outputQty,
    });
    setBusy(false);
    const row = data as { ok?: boolean; error?: string };
    if (error || !row?.ok) {
      if (row?.error === "forbidden") {
        toast.error("Sem permissão.");
        return;
      }
      toast.error(
        error?.message || "Não foi possível baixar o estoque dos insumos.",
      );
      return;
    }
    toast.success("Estoque dos ingredientes atualizado.");
    onProduced?.();
  };

  return (
    <div
      className={cn(
        "space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {mode === "produce" ? "Produzir" : "Preparar"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Informe quantas receitas vai fazer. A entrada é esse número vezes o
          rendimento; os insumos saem na quantidade da ficha vezes as receitas.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="recipe-batches">Quantidade de receitas</Label>
        <Input
          id="recipe-batches"
          type="number"
          step="1"
          min="0.01"
          value={batchesRaw}
          onChange={(e) => setBatchesRaw(e.target.value)}
          className="h-11 rounded-xl"
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Rendimento de cada receita: {formatProductionQty(batchYield || 0)}
        </p>
      </div>
      {preview ? (
        <RecipeProductionSummary
          preview={preview}
          showEntry={mode === "produce"}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Informe um número maior que zero para ver o resumo.
        </p>
      )}
      <Button
        type="button"
        className="h-11 w-full rounded-xl"
        disabled={busy || !preview}
        onClick={() => {
          if (!preview) {
            toast.error("Informe quantas receitas vai produzir.");
            return;
          }
          setConfirmOpen(true);
        }}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : mode === "produce" ? (
          <>
            <Factory className="mr-2 h-4 w-4" />
            Produzir
          </>
        ) : (
          "Baixar estoque"
        )}
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!busy) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "produce"
                ? "Confirmar produção?"
                : "Confirmar baixa dos insumos?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {mode === "produce" && preview ? (
                <>
                  Vão entrar{" "}
                  <strong className="text-foreground">
                    {formatProductionQty(preview.outputQty)} {preview.outputUnit}
                  </strong>{" "}
                  de{" "}
                  <strong className="text-foreground">{preview.outputName}</strong>{" "}
                  no estoque ({formatProductionQty(preview.batches)}{" "}
                  {preview.batches === 1 ? "receita" : "receitas"} ×{" "}
                  {formatProductionQty(preview.batchYield)} de rendimento). Os
                  insumos do resumo serão baixados. Confirma?
                </>
              ) : preview ? (
                <>
                  Vão sair os insumos de{" "}
                  <strong className="text-foreground">
                    {formatProductionQty(preview.batches)}{" "}
                    {preview.batches === 1 ? "receita" : "receitas"}
                  </strong>
                  . Confirma?
                </>
              ) : (
                "Confirme para continuar."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              {busy
                ? "Confirmando…"
                : mode === "produce"
                  ? "Confirmar produção"
                  : "Confirmar baixa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

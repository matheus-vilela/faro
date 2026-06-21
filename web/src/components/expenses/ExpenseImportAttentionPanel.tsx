import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXPENSE_DIVERGENCE_REASONS,
  valuesDivergeCents,
} from "@/lib/expenseDivergenceUi";
import { AlertTriangle, PackageSearch, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

type ExpenseImportAttentionPanelProps = {
  totalNota: number;
  sumItens: number;
  divergenceReasonValue: string;
  onDivergenceReasonChange: (value: string) => void;
  /** Documento ou extração pediu revisão de produto (ex.: match fraco no catálogo). */
  requiresProductConfirmation?: boolean;
  /** Linhas com match fraco (opcional; reforça o bloco de produto). */
  productReviewLineCount?: number;
  className?: string;
};

/**
 * Destaque visual para divergência de valores vs soma e para revisão de vínculo de produto.
 */
export function ExpenseImportAttentionPanel({
  totalNota,
  sumItens,
  divergenceReasonValue,
  onDivergenceReasonChange,
  requiresProductConfirmation = false,
  productReviewLineCount = 0,
  className,
}: ExpenseImportAttentionPanelProps) {
  const diverge = valuesDivergeCents(totalNota, sumItens);
  const delta = totalNota - sumItens;
  const showProductBlock =
    requiresProductConfirmation || productReviewLineCount > 0;

  if (!diverge && !showProductBlock) return null;

  return (
    <div className={className ?? "space-y-3"}>
      {diverge && (
        <div
          className="rounded-xl border-2 border-destructive/35 bg-destructive/5 p-4 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive"
              aria-hidden
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Valores não conferem
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O total do documento precisa bater com a soma dos itens (ou
                  ajuste linhas até fechar). Se a diferença for esperada
                  (imposto, frete, etc.), indique abaixo para registro.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-border/80 bg-background/80 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Total no documento
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatBrl(totalNota)}
                  </p>
                </div>
                <div className="rounded-lg border border-border/80 bg-background/80 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Soma dos itens
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatBrl(sumItens)}
                  </p>
                </div>
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 sm:col-span-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-destructive/90">
                    Diferença
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-destructive">
                    {delta >= 0 ? "+" : ""}
                    {formatBrl(delta)}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="divergence-reason"
                  className="text-xs font-medium"
                >
                  Motivo provável da divergência (opcional)
                </Label>
                <Select
                  value={divergenceReasonValue || "__none__"}
                  onValueChange={(v) =>
                    onDivergenceReasonChange(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger id="divergence-reason" className="w-full">
                    <SelectValue placeholder="Selecione se souber o motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Não informar</SelectItem>
                    {EXPENSE_DIVERGENCE_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProductBlock && (
        <div className="rounded-xl border-2 border-violet-500/35 bg-violet-500/5 p-4 shadow-sm">
          <div className="flex gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300"
              aria-hidden
            >
              <PackageSearch className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                Revisar produto vinculado
                {productReviewLineCount > 0 && (
                  <span className="inline-flex items-center rounded-md bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-900 dark:text-violet-100">
                    {productReviewLineCount}{" "}
                    {productReviewLineCount === 1 ? "linha" : "linhas"}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Pelo menos uma descrição da nota não teve correspondência
                automática forte no seu cadastro (menos de 95% de similaridade).
                Confira cada linha: escolha um produto existente ou cadastre um
                novo — o Faro memoriza para a próxima compra.
              </p>
            </div>
          </div>
        </div>
      )}

      {!diverge && showProductBlock && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <span>
            Os valores da nota e da soma dos itens estão alinhados. Foque em
            confirmar o vínculo dos produtos nas linhas destacadas abaixo.
          </span>
        </p>
      )}
    </div>
  );
}

/** Resumo somente leitura no detalhe da despesa (importação já gravada). */
export function ExpenseRecordedDivergenceBanner({
  documentTotal: _documentTotal,
  sumLines: _sumLines,
  financialReconciliationJson: _financialReconciliationJson,
  divergenceReason,
  unlinkedProductRowCount,
}: {
  documentTotal: number | null | undefined;
  sumLines: number;
  financialReconciliationJson?: Record<string, unknown> | null;
  divergenceReason?: string | null;
  unlinkedProductRowCount: number;
}): ReactNode {
  const hasDoc =
    _documentTotal != null && Number.isFinite(Number(_documentTotal));
  const hasReason = !!(divergenceReason && divergenceReason.trim());
  const hasProductsIssue = unlinkedProductRowCount > 0;

  if (!hasDoc && !hasReason && !hasProductsIssue) return null;

  return (
    <div className="space-y-3">
      {hasProductsIssue && (
        <div className="rounded-xl border-2 border-violet-500/35 bg-violet-500/5 p-4">
          <div className="flex gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300"
              aria-hidden
            >
              <PackageSearch className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">Produto sem vínculo no estoque</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {unlinkedProductRowCount}{" "}
                {unlinkedProductRowCount === 1
                  ? "linha ainda não está vinculada"
                  : "linhas ainda não estão vinculadas"}{" "}
                a um produto do cadastro. Use <strong>Editar</strong> ou o botão
                na tabela para vincular antes do recebimento.
              </p>
            </div>
          </div>
        </div>
      )}

      {hasReason && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Motivo indicado na importação:{" "}
          </span>
          <span className="font-medium">{divergenceReason}</span>
        </div>
      )}
    </div>
  );
}

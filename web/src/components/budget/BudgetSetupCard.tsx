import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Copy, Sparkles, Table2, Target } from "lucide-react";

export function BudgetSetupCard({
  hasActual,
  canApplyAvg,
  canCopyPrevious,
  bulkLoading,
  onApplyAvg,
  onCopyPrevious,
  onScrollToTable,
}: {
  hasActual: boolean;
  canApplyAvg: boolean;
  canCopyPrevious: boolean;
  bulkLoading: boolean;
  onApplyAvg: () => void;
  onCopyPrevious: () => void;
  onScrollToTable: () => void;
}) {
  return (
    <Card className="border-primary/25 bg-primary/5 shadow-sm">
      <CardHeader className="pb-3">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Target className="h-5 w-5" />
        </div>
        <CardTitle className="text-base">Defina o orçado deste mês</CardTitle>
        <CardDescription>
          {hasActual
            ? "Há gastos no período, mas ainda não há meta. O realizado entra sozinho das contas a pagar; o orçado você define."
            : "Metas por categoria de despesa. O realizado entra sozinho das contas a pagar classificadas."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="sm"
          disabled={bulkLoading || !canApplyAvg}
          title={
            canApplyAvg
              ? undefined
              : "Não há média dos 3 meses anteriores. Classifique despesas nos meses passados ou preencha na tabela."
          }
          onClick={onApplyAvg}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Usar média dos 3 meses
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={bulkLoading || !canCopyPrevious}
          title={
            canCopyPrevious
              ? undefined
              : "Não há orçamentos no mês anterior para copiar."
          }
          onClick={onCopyPrevious}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copiar do mês anterior
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onScrollToTable}
        >
          <Table2 className="mr-2 h-4 w-4" />
          Preencher na tabela abaixo
        </Button>
      </CardContent>
    </Card>
  );
}

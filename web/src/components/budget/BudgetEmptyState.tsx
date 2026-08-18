import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "react-router-dom";
import { FolderTree, Target } from "lucide-react";

export function BudgetEmptyState({
  variant = "missing-categories",
}: {
  variant?: "missing-categories" | "unmapped";
}) {
  const unmapped = variant === "unmapped";

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Target className="h-6 w-6" />
        </div>
        <CardTitle className="text-base">
          {unmapped
            ? "Categorias de despesa fora do plano DRE"
            : "Configure suas categorias de despesa"}
        </CardTitle>
        <CardDescription>
          {unmapped
            ? "Há categorias de despesa, mas nenhuma está mapeada (tipo CMV, variável, fixa, impostos…). Ajuste o tipo em Configurações para orçar."
            : "Para definir metas de custo, cadastre categorias de despesa em Configurações. Depois volte aqui para informar o orçamento mensal."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-8">
        <Button asChild variant="outline">
          <Link to="/app/configuracoes/categorias">
            <FolderTree className="mr-2 h-4 w-4" />
            Ir para categorias
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

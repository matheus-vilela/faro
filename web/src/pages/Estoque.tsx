import { EstoqueMovimentacoesPanel } from "@/components/estoque/EstoqueMovimentacoesPanel";
import { useCompany } from "@/contexts/CompanyContext";
import type { MovementClassificationFilter } from "@/lib/stockMovementClassification";
import { useSearchParams } from "react-router-dom";

function parseClassification(
  value: string | null,
): MovementClassificationFilter | undefined {
  if (value === "perda" || value === "loss") return "loss";
  return undefined;
}

export function Estoque() {
  const { currentCompany } = useCompany();
  const [searchParams] = useSearchParams();
  const initialClassification = parseClassification(
    searchParams.get("classificacao"),
  );

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return (
    <EstoqueMovimentacoesPanel
      companyId={currentCompany.id}
      initialClassification={initialClassification}
    />
  );
}

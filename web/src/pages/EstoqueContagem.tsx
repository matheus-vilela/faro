import { EstoqueContagemPanel } from "@/components/estoque/EstoqueContagemPanel";
import { useCompany } from "@/contexts/CompanyContext";

export function EstoqueContagem() {
  const { currentCompany } = useCompany();

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return <EstoqueContagemPanel companyId={currentCompany.id} />;
}

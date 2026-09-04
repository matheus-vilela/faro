import { SaleFamiliesPanel } from "@/components/products/SaleFamiliesPanel";
import { useCompany } from "@/contexts/CompanyContext";

export function FamiliasVenda() {
  const { currentCompany } = useCompany();

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return <SaleFamiliesPanel companyId={currentCompany.id} />;
}

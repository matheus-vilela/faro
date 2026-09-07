import { PageHeader } from "@/components/PageHeader";
import { ProductValidationFlow } from "@/components/products/ProductValidationFlow";
import { useCompany } from "@/contexts/CompanyContext";
import { Link2 } from "lucide-react";

export function ProdutosHome() {
  const { currentCompany } = useCompany();

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        icon={Link2}
        title="Classificar"
        description="Defina o que cada item é — unificar, ficha, agrupamento ou insumo — para o estoque bater com a nota e a venda."
      />

      <ProductValidationFlow companyId={currentCompany.id} />
    </div>
  );
}

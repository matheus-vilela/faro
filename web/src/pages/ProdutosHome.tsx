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
        title="Correlação"
        description="Cruza o que saiu no PDV com o que entrou nas notas fiscais para alinhar cadastro, estoque e movimentações."
      />

      <ProductValidationFlow companyId={currentCompany.id} />
    </div>
  );
}

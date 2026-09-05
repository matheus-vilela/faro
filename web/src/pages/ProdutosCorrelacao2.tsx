import { CorrelationV2Flow } from "@/components/products/correlacao2/CorrelationV2Flow";
import { PageHeader } from "@/components/PageHeader";
import { useCompany } from "@/contexts/CompanyContext";
import { Link2 } from "lucide-react";

export function ProdutosCorrelacao2() {
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
        title="Correlação 2"
        description="Uma fila de casos. O inspector à direita confirma o papel. A IA só sugere o par."
      />
      <CorrelationV2Flow companyId={currentCompany.id} />
    </div>
  );
}

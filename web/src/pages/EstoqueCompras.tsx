import { EstoqueComprasPanel } from "@/components/estoque/EstoqueComprasPanel";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { PRODUCT_CATALOG_PATH } from "@/lib/productStockPaths";
import { Package } from "lucide-react";
import { Link } from "react-router-dom";

export function EstoqueCompras() {
  const { currentCompany } = useCompany();

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to={`${PRODUCT_CATALOG_PATH}?estoque=baixo`}>
            <Package className="mr-2 h-4 w-4" />
            Ver o que repor
          </Link>
        </Button>
      </div>
      <EstoqueComprasPanel companyId={currentCompany.id} />
    </div>
  );
}

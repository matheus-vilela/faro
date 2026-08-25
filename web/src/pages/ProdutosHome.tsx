import { PageHeader } from "@/components/PageHeader";
import { ProductCatalogKpis } from "@/components/products/ProductCatalogKpis";
import { ProductValidationFlow } from "@/components/products/ProductValidationFlow";
import { useCompany } from "@/contexts/CompanyContext";
import {
  fetchCatalogStockKpis,
  type CatalogStockKpis,
} from "@/lib/productCatalogValue";
import {
  PRODUCT_CATALOG_PATH,
  productLowStockPath,
} from "@/lib/productStockPaths";
import { Home } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function ProdutosHome() {
  const { currentCompany } = useCompany();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<CatalogStockKpis | null>(null);

  const loadKpis = useCallback(async () => {
    if (!currentCompany?.id) return;
    const next = await fetchCatalogStockKpis(currentCompany.id);
    setKpis(next);
  }, [currentCompany?.id]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        icon={Home}
        title="Início"
        description="Insights do estoque e validação dos produtos: o que é ficha, o que é o mesmo item da nota, e quais compras podem ser insumos."
      />

      {kpis ? (
        <ProductCatalogKpis
          kpis={kpis}
          formatCurrency={formatCurrency}
          onBelowMin={() => navigate(productLowStockPath())}
          onZero={() => navigate(PRODUCT_CATALOG_PATH)}
        />
      ) : null}

      <ProductValidationFlow companyId={currentCompany.id} />
    </div>
  );
}

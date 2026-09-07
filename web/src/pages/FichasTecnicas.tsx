import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { useCompany } from "@/contexts/CompanyContext";
import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

export function FichasTecnicas() {
  const { currentCompany } = useCompany();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const recipeOutputProductId =
    searchParams.get("recipeOutputProduct")?.trim() || undefined;
  const listKind = pathname.endsWith("/producao") ? "production" : "sale";

  const clearRecipeOutputProductParam = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    if (!next.has("recipeOutputProduct")) return;
    next.delete("recipeOutputProduct");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!currentCompany?.id) {
    return (
      <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
    );
  }

  return (
    <EstoqueReceitasPanel
      companyId={currentCompany.id}
      listKind={listKind}
      prefillNewRecipeOutputProductId={recipeOutputProductId}
      onPrefillConsumed={clearRecipeOutputProductParam}
    />
  );
}

import { ProdutosHome } from "@/pages/ProdutosHome";
import {
  PRODUCT_CATALOG_PATH,
  PRODUCT_HOME_PATH,
  RECIPES_PATH,
  RECIPES_PENDING_PATH,
  STOCK_COUNT_PATH,
  STOCK_LEDGER_PATH,
  STOCK_PURCHASES_PATH,
} from "@/lib/productStockPaths";
import { Navigate, useSearchParams } from "react-router-dom";

function withRemainingParams(
  path: string,
  params: URLSearchParams,
  drop: string[],
): string {
  const next = new URLSearchParams(params);
  for (const key of drop) next.delete(key);
  const q = next.toString();
  return q ? `${path}?${q}` : path;
}

/** Deep links antigos (`?aba=`, `?estoque=receitas`) → destinos atuais. */
export function ProdutosLegacyRedirect() {
  const [params] = useSearchParams();
  const aba = params.get("aba");
  const estoque = params.get("estoque");

  if (aba === "contagem") {
    return <Navigate to={STOCK_COUNT_PATH} replace />;
  }
  if (aba === "vinculos" || aba === "fichas") {
    return <Navigate to={PRODUCT_HOME_PATH} replace />;
  }
  if (aba === "receitas") {
    return (
      <Navigate
        to={withRemainingParams(RECIPES_PATH, params, ["aba"])}
        replace
      />
    );
  }
  if (aba === "movimentos") {
    return <Navigate to={STOCK_LEDGER_PATH} replace />;
  }
  if (aba === "perdas") {
    return <Navigate to={`${STOCK_LEDGER_PATH}?classificacao=perda`} replace />;
  }
  if (aba === "compras") {
    return <Navigate to={STOCK_PURCHASES_PATH} replace />;
  }
  if (aba === "etiquetas" || aba === "cmv" || aba === "catalogo") {
    return (
      <Navigate
        to={withRemainingParams(PRODUCT_CATALOG_PATH, params, ["aba"])}
        replace
      />
    );
  }
  if (
    params.get("highlight")?.trim() ||
    params.get("compras") ||
    params.get("estoque") === "baixo"
  ) {
    return (
      <Navigate
        to={withRemainingParams(PRODUCT_CATALOG_PATH, params, [])}
        replace
      />
    );
  }
  if (estoque === "receitas") {
    return (
      <Navigate
        to={withRemainingParams(RECIPES_PATH, params, ["estoque"])}
        replace
      />
    );
  }
  if (params.get("recipeOutputProduct")?.trim()) {
    return (
      <Navigate
        to={withRemainingParams(RECIPES_PATH, params, [])}
        replace
      />
    );
  }
  return <ProdutosHome />;
}

export function FichasInboxRedirect() {
  const [params] = useSearchParams();
  const inbox = params.get("inbox");
  if (inbox === "pendentes") {
    return <Navigate to={RECIPES_PENDING_PATH} replace />;
  }
  if (inbox === "vinculos") {
    return <Navigate to={RECIPES_PATH} replace />;
  }
  return (
    <Navigate
      to={withRemainingParams(RECIPES_PATH, params, ["inbox"])}
      replace
    />
  );
}

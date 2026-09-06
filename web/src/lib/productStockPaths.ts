export const PRODUCT_HOME_PATH = "/app/produtos";
export const PRODUCT_CATALOG_PATH = "/app/produtos/catalogo";
export const STOCK_LEDGER_PATH = "/app/produtos/estoque";
export const STOCK_COUNT_PATH = "/app/produtos/contagem";
export const STOCK_PURCHASES_PATH = "/app/produtos/estoque/compras";
export const RECIPES_PATH = "/app/produtos/fichas";
export const RECIPES_PENDING_PATH = "/app/produtos/fichas/pendentes";
export const RECIPES_MATCH_PATH = "/app/produtos/fichas/vinculos";
export const SALE_FAMILIES_PATH = "/app/produtos/familias";
export const SERVICES_PATH = "/app/produtos/servicos";

export function productHighlightPath(productId: string): string {
  return `${PRODUCT_CATALOG_PATH}?highlight=${encodeURIComponent(productId)}`;
}

export function productLowStockPath(): string {
  return `${PRODUCT_CATALOG_PATH}?estoque=baixo`;
}

export function recipesPendingPath(): string {
  return RECIPES_PENDING_PATH;
}

export function recipesMatchPath(): string {
  return RECIPES_PATH;
}

export function stockLossesPath(): string {
  return `${STOCK_LEDGER_PATH}?classificacao=perda`;
}

export function recipeOutputPath(productId: string): string {
  return `${RECIPES_PATH}?recipeOutputProduct=${encodeURIComponent(productId)}`;
}

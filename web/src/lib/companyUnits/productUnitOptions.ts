export {
  buildProductUnitSelectOptions,
  getSystemProductUnitSelectOptions,
  getSystemProductUnitSelectOptionsWithLegacy,
  isSystemUnitCode,
  isUnitInCompanyCatalog,
  systemUnitLabel,
  SYSTEM_PRODUCT_UNITS,
  type CompanyUnitAliasRow,
} from "@/lib/companyUnits/systemUnits";

/** Padrão ao abrir cadastro de produto (unidade de estoque). */
export function defaultProductStockUnitCode(): string {
  return "un";
}

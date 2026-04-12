export {
  getSystemProductUnitSelectOptions,
  getSystemProductUnitSelectOptionsWithLegacy,
  isSystemUnitCode,
  systemUnitLabel,
  SYSTEM_PRODUCT_UNITS,
} from "@/lib/companyUnits/systemUnits";

/** Padrão ao abrir cadastro de produto (unidade de estoque). */
export function defaultProductStockUnitCode(): string {
  return "un";
}

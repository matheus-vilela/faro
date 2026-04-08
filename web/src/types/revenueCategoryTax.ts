import type { RevenueTaxType } from "@/types/revenue";

/** Taxa padrão por folha de receita (Configurações → Impostos na receita). */
export type CompanyRevenueCategoryTaxSetting = {
  id?: string;
  company_id: string;
  category_id: string;
  tax_type: RevenueTaxType;
  tax_value: number;
};

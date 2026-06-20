export type RevenueEntryMode = "manual" | "product_sale" | "recipe_sale";

export type RevenueTypeFilter = "operational" | "non_operational";

/** Alinhado ao banco / RPC */
export type RevenueTaxType = "currency" | "percentage";

export type ProductSalePricingMode = "unit" | "total";

export type RevenueIntegrationImportBatchStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

/** Lote de import automático de receitas (tabela company_revenue_integration_import_batches). */
export interface CompanyRevenueIntegrationImportBatch {
  id: string;
  company_id: string;
  provider: string;
  reference_date: string;
  status: RevenueIntegrationImportBatchStatus;
  revenue_entry_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RevenueEntry {
  id: string;
  company_id: string;
  created_by: string | null;
  entry_date: string;
  title: string;
  entry_mode: RevenueEntryMode;
  revenue_type: RevenueTypeFilter;
  category_id: string | null;
  subcategory_id: string;
  product_id: string | null;
  recipe_id: string | null;
  quantity: number | null;
  pricing_mode: ProductSalePricingMode | null;
  unit_value: number | null;
  gross_amount: number;
  tax_type: RevenueTaxType;
  tax_value: number;
  tax_amount: number;
  net_amount: number;
  source: RevenueEntryMode;
  /** Preenchido quando o lançamento veio de import automático (lote). */
  integration_import_batch_id?: string | null;
  /** Unidade informada na venda pontual de produto. */
  sale_unit_code?: string | null;
  /** CMV total reconhecido nesta venda (DRE por data da receita). */
  cmv_amount?: number;
  cmv_lines?: unknown;
  cmv_needs_backfill?: boolean;
  created_at: string;
  updated_at: string;
}

export function computeRevenueTaxDeduction(input: {
  gross: number;
  taxType: RevenueTaxType;
  taxValue: number;
}): { taxAmount: number; netAmount: number } {
  const gross = Math.max(0, Number(input.gross) || 0);
  let taxAmount = 0;
  if (input.taxType === "percentage") {
    taxAmount = Math.round(((gross * Number(input.taxValue || 0)) / 100) * 100) / 100;
  } else {
    taxAmount = Math.min(Math.max(0, Number(input.taxValue) || 0), gross);
  }
  const netAmount = Math.round((gross - taxAmount) * 100) / 100;
  return { taxAmount, netAmount };
}

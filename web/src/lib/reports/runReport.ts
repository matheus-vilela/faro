import {
  buildFinancialMovementReport,
  buildPayablesOpenReport,
  buildPayablesOverdueReport,
  buildPaymentsMadeReport,
  buildReceiptsMadeReport,
  buildReceivablesOpenReport,
} from "./builders/boletos";
import { buildBudgetReport } from "./builders/budget";
import {
  buildCashFlowByCategoryReport,
  buildCashFlowSummaryReport,
} from "./builders/cashFlow";
import { buildCmvMarginsReport } from "./builders/cmv";
import { buildDreReport, buildDreUncategorizedReport } from "./builders/dre";
import { buildExpensesReport } from "./builders/expenses";
import { buildReconciliationReport } from "./builders/reconciliation";
import {
  buildEpocBillingReport,
  buildSalesSummaryReport,
} from "./builders/sales";
import {
  buildStockCatalogReport,
  buildStockMovementsReport,
} from "./builders/stock";
import { buildSuppliersReport } from "./builders/suppliers";
import type { ReportId, ReportResult, ReportRunContext } from "./types";

const BUILDERS: Record<
  ReportId,
  (ctx: ReportRunContext) => Promise<ReportResult>
> = {
  payables_open: buildPayablesOpenReport,
  payables_overdue: buildPayablesOverdueReport,
  payments_made: buildPaymentsMadeReport,
  receivables_open: buildReceivablesOpenReport,
  receipts_made: buildReceiptsMadeReport,
  financial_movement: buildFinancialMovementReport,
  cash_flow_by_category: buildCashFlowByCategoryReport,
  cash_flow_summary: buildCashFlowSummaryReport,
  dre: buildDreReport,
  dre_uncategorized: buildDreUncategorizedReport,
  budget: buildBudgetReport,
  sales_summary: buildSalesSummaryReport,
  epoc_billing: buildEpocBillingReport,
  cmv_margins: buildCmvMarginsReport,
  suppliers: buildSuppliersReport,
  expenses: buildExpensesReport,
  stock_movements: buildStockMovementsReport,
  stock_catalog: buildStockCatalogReport,
  reconciliation: buildReconciliationReport,
};

export async function runReport(
  id: ReportId,
  ctx: ReportRunContext,
): Promise<ReportResult> {
  return BUILDERS[id](ctx);
}

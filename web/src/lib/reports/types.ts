import type { CmvPeriodFilter } from "@/lib/cmvMargensResumo";
import type { ProductExportFilterState } from "@/lib/productCatalogFilters";
import type { PermissionKey } from "@/lib/permissions";
import type { BudgetBasis } from "@/lib/budget/types";
import type {
  HorizonWeeks,
  ScenarioKey,
} from "@/lib/cashFlowSimulation/types";
import type { MovementDirectionFilter } from "@/lib/stockMovementFilters";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type ReportId =
  | "payables_open"
  | "payables_overdue"
  | "payments_made"
  | "receivables_open"
  | "receipts_made"
  | "financial_movement"
  | "cash_flow_by_category"
  | "cash_flow_summary"
  | "dre"
  | "dre_uncategorized"
  | "budget"
  | "sales_summary"
  | "epoc_billing"
  | "cmv_margins"
  | "suppliers"
  | "expenses"
  | "stock_movements"
  | "stock_catalog"
  | "reconciliation";

export type ReportGroup = "financeiro" | "gestao" | "operacao";

export type ReportFilterKey =
  | "period"
  | "month"
  | "dateField"
  | "openDueBucket"
  | "category"
  | "supplier"
  | "search"
  | "bankAccount"
  | "basis"
  | "natureza"
  | "flowType"
  | "situation"
  | "expenseStatus"
  | "expenseOrigin"
  | "reconStatus"
  | "dreView"
  | "stockMode"
  | "scenario"
  | "cmvPeriod"
  | "movementDirection";

export type ReportColumnFormat = "text" | "date" | "money" | "number";

export type ReportColumn = {
  key: string;
  header: string;
  align?: "left" | "right";
  format?: ReportColumnFormat;
};

export type ReportRow = Record<string, unknown>;

export type ReportTable = {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
};

export type ReportResult = {
  title: string;
  slug: string;
  subtitle?: string;
  metaLines: string[];
  tables: ReportTable[];
};

export type OpenDueBucket = "all" | "overdue" | "upcoming";
export type DateField = "due_date" | "paid_at";
export type FlowTypeFilter = "payable" | "receivable" | "both";
export type SituationFilter = "all" | "pending" | "paid";
export type NaturezaFilter = "all" | "RECEITA" | "DESPESA";
export type DreViewFilter = "resumo" | "linhas";
export type StockModeFilter = "filtered" | "all";
export type ExpenseStatusFilter = "all" | "pending" | "approved" | "rejected";
export type ExpenseOriginFilter = "all" | "manual" | "whatsapp";
export type ReconStatusFilter = "all" | "unmatched" | "matched" | "ignored";

export type ReportFilterState = {
  dateFrom: string;
  dateTo: string;
  dateField: DateField;
  openDueBucket: OpenDueBucket;
  categoryId: string;
  supplierId: string;
  search: string;
  bankAccountId: string;
  basis: BudgetBasis;
  natureza: NaturezaFilter;
  flowType: FlowTypeFilter;
  situation: SituationFilter;
  expenseStatus: ExpenseStatusFilter;
  expenseOrigin: ExpenseOriginFilter;
  reconStatus: ReconStatusFilter;
  dreView: DreViewFilter;
  stockMode: StockModeFilter;
  month: number;
  year: number;
  scenario: ScenarioKey;
  horizonWeeks: HorizonWeeks;
  openingBalance: number;
  cmvPeriod: CmvPeriodFilter;
  movementDirection: MovementDirectionFilter;
};

export type ReportDefinition = {
  id: ReportId;
  title: string;
  description: string;
  group: ReportGroup;
  permission: PermissionKey | readonly PermissionKey[];
  filters: readonly ReportFilterKey[];
  defaults?: Partial<ReportFilterState>;
};

export type ReportRunContext = {
  companyId: string;
  companyName: string;
  filters: ReportFilterState;
  permissions: readonly string[] | null | undefined;
  isCompanyOwner: boolean;
  weekStartsOn?: number;
  stockFilters?: ProductExportFilterState;
};

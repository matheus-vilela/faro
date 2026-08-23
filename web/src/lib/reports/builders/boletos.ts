import {
  boletoCounterpartyLabel,
  formatBoletoFluxoDescription,
} from "@/lib/boletoFluxoDescription";
import { localDateYmd } from "@/lib/boletoPayment";
import { hasPermission } from "@/lib/permissions";
import type { ReportColumn, ReportResult, ReportRunContext } from "../types";
import {
  applyBoletoClientFilters,
  boletoFlowLabel,
  boletoSituationLabel,
  fetchBoletoLookups,
  fetchBoletosForReport,
  type BoletoReportRow,
} from "../fetchBoletos";
import { periodLabel } from "../formatters";

const COLUMNS: ReportColumn[] = [
  { key: "due_date", header: "Vencimento", format: "date" },
  { key: "paid_at", header: "Pagamento", format: "date" },
  { key: "description", header: "Descrição" },
  { key: "counterparty", header: "Fornecedor / origem" },
  { key: "category", header: "Categoria" },
  { key: "flow", header: "Tipo" },
  { key: "situation", header: "Situação" },
  { key: "amount", header: "Valor", format: "money", align: "right" },
  { key: "paid_amount", header: "Valor pago", format: "money", align: "right" },
  { key: "interest", header: "Juros", format: "money", align: "right" },
  { key: "discount", header: "Desconto", format: "money", align: "right" },
  { key: "bank", header: "Conta bancária" },
];

function mapRows(
  rows: BoletoReportRow[],
  lookups: Awaited<ReturnType<typeof fetchBoletoLookups>>,
  todayYmd: string,
) {
  return rows.map((b) => ({
    due_date: b.due_date,
    paid_at: b.paid_at ?? "",
    description: formatBoletoFluxoDescription(b),
    counterparty: boletoCounterpartyLabel(b) ?? "",
    category: b.company_category_id
      ? (lookups.categoryById.get(b.company_category_id) ?? "")
      : "",
    flow: boletoFlowLabel(b.flow_type),
    situation: boletoSituationLabel(b, todayYmd),
    amount: Number(b.amount) || 0,
    paid_amount: b.paid_amount != null ? Number(b.paid_amount) : "",
    interest: Number(b.interest_amount) || 0,
    discount: Number(b.discount_amount) || 0,
    bank: b.company_bank_account_id
      ? (lookups.bankById.get(b.company_bank_account_id) ?? "")
      : "",
  }));
}

function metaFor(ctx: ReportRunContext, extra: string[]): string[] {
  const f = ctx.filters;
  return [
    `Empresa: ${ctx.companyName}`,
    `Período: ${periodLabel(f.dateFrom, f.dateTo)}`,
    ...extra,
  ];
}

export async function buildPayablesOpenReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, lookups] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "payable",
      dateField: "due_date",
      dateFrom: ctx.filters.dateFrom,
      dateTo: ctx.filters.dateTo,
      status: "pending",
      includeProjectedPayables: true,
    }),
    fetchBoletoLookups(ctx.companyId),
  ]);
  const filtered = applyBoletoClientFilters(rows, ctx.filters, today);
  const bucket =
    ctx.filters.openDueBucket === "overdue"
      ? "Somente vencidas"
      : ctx.filters.openDueBucket === "upcoming"
        ? "Somente a vencer"
        : "Todas em aberto";
  return {
    title: "Contas a pagar em aberto",
    slug: "contas_pagar_aberto",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, [bucket]),
    tables: [
      {
        title: "Contas",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

export async function buildPayablesOverdueReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, lookups] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "payable",
      dateField: "due_date",
      dateFrom: ctx.filters.dateFrom,
      dateTo: today,
      status: "pending",
      includeProjectedPayables: true,
    }),
    fetchBoletoLookups(ctx.companyId),
  ]);
  const filtered = applyBoletoClientFilters(
    rows,
    { ...ctx.filters, openDueBucket: "overdue" },
    today,
  );
  return {
    title: "Contas a pagar vencidas",
    slug: "contas_pagar_vencidas",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, ["Situação: vencidas (pendentes com vencimento anterior a hoje)"]),
    tables: [
      {
        title: "Vencidas",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

export async function buildPaymentsMadeReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, lookups] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "payable",
      dateField: "paid_at",
      dateFrom: ctx.filters.dateFrom,
      dateTo: ctx.filters.dateTo,
      status: "paid",
    }),
    fetchBoletoLookups(ctx.companyId),
  ]);
  const filtered = applyBoletoClientFilters(
    rows,
    { ...ctx.filters, openDueBucket: "all", situation: "paid" },
    today,
  );
  return {
    title: "Pagamentos realizados",
    slug: "pagamentos_realizados",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, ["Data: pagamento"]),
    tables: [
      {
        title: "Pagamentos",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

export async function buildReceivablesOpenReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, lookups] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "receivable",
      dateField: "due_date",
      dateFrom: ctx.filters.dateFrom,
      dateTo: ctx.filters.dateTo,
      status: "pending",
    }),
    fetchBoletoLookups(ctx.companyId),
  ]);
  const filtered = applyBoletoClientFilters(rows, ctx.filters, today);
  const bucket =
    ctx.filters.openDueBucket === "overdue"
      ? "Somente vencidas"
      : ctx.filters.openDueBucket === "upcoming"
        ? "Somente a vencer"
        : "Todas em aberto";
  return {
    title: "Contas a receber em aberto",
    slug: "contas_receber_aberto",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, [bucket]),
    tables: [
      {
        title: "Receber",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

export async function buildReceiptsMadeReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, lookups] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "receivable",
      dateField: "paid_at",
      dateFrom: ctx.filters.dateFrom,
      dateTo: ctx.filters.dateTo,
      status: "paid",
    }),
    fetchBoletoLookups(ctx.companyId),
  ]);
  const filtered = applyBoletoClientFilters(
    rows,
    { ...ctx.filters, openDueBucket: "all", situation: "paid" },
    today,
  );
  return {
    title: "Recebimentos realizados",
    slug: "recebimentos_realizados",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, ["Data: recebimento"]),
    tables: [
      {
        title: "Recebimentos",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

export async function buildFinancialMovementReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const includePayables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "contas_a_pagar");
  const includeReceivables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "vendas_realizadas");
  const dateField =
    ctx.filters.dateField === "paid_at" ? "paid_at" : "due_date";
  const flow = ctx.filters.flowType;
  const status =
    dateField === "paid_at"
      ? "paid"
      : ctx.filters.situation === "paid"
        ? "paid"
        : ctx.filters.situation === "pending"
          ? "pending"
          : undefined;

  const jobs: Promise<BoletoReportRow[]>[] = [];
  if (includePayables && flow !== "receivable") {
    jobs.push(
      fetchBoletosForReport({
        companyId: ctx.companyId,
        flowType: "payable",
        dateField,
        dateFrom: ctx.filters.dateFrom,
        dateTo: ctx.filters.dateTo,
        status,
        includeProjectedPayables: dateField === "due_date" && status !== "paid",
      }),
    );
  }
  if (includeReceivables && flow !== "payable") {
    jobs.push(
      fetchBoletosForReport({
        companyId: ctx.companyId,
        flowType: "receivable",
        dateField,
        dateFrom: ctx.filters.dateFrom,
        dateTo: ctx.filters.dateTo,
        status,
      }),
    );
  }
  const [lookups, ...lists] = await Promise.all([
    fetchBoletoLookups(ctx.companyId),
    ...jobs,
  ]);
  const merged = lists.flat();
  const filtered = applyBoletoClientFilters(merged, ctx.filters, today);
  filtered.sort((a, b) => {
    const da = String(
      dateField === "paid_at" ? a.paid_at ?? a.due_date : a.due_date,
    );
    const db = String(
      dateField === "paid_at" ? b.paid_at ?? b.due_date : b.due_date,
    );
    return da.localeCompare(db);
  });
  return {
    title: "Movimentação financeira",
    slug: "movimentacao_financeira",
    subtitle: ctx.companyName,
    metaLines: metaFor(ctx, [
      `Base: ${dateField === "paid_at" ? "caixa (pagamento)" : "competência (vencimento)"}`,
    ]),
    tables: [
      {
        title: "Movimentação",
        columns: COLUMNS,
        rows: mapRows(filtered, lookups, today),
      },
    ],
  };
}

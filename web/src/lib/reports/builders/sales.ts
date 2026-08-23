import { localDateYmd } from "@/lib/boletoPayment";
import { companyCategoryDisplayName } from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { CompanyCategory } from "@/types/category";
import { periodLabel } from "../formatters";
import {
  applyBoletoClientFilters,
  boletoSituationLabel,
  fetchBoletosForReport,
} from "../fetchBoletos";
import type { ReportResult, ReportRunContext } from "../types";

export async function buildSalesSummaryReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const today = localDateYmd();
  const [rows, catRes] = await Promise.all([
    fetchBoletosForReport({
      companyId: ctx.companyId,
      flowType: "receivable",
      dateField: "due_date",
      dateFrom: ctx.filters.dateFrom,
      dateTo: ctx.filters.dateTo,
    }),
    supabase.from("company_categories").select("*").eq("company_id", ctx.companyId),
  ]);
  if (catRes.error) throw catRes.error;
  const categories = (catRes.data ?? []) as CompanyCategory[];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const filtered = applyBoletoClientFilters(rows, ctx.filters, today);

  let open = 0;
  let paid = 0;
  let overdue = 0;
  const byCat = new Map<string, { open: number; paid: number }>();
  for (const b of filtered) {
    const amount = Number(b.amount) || 0;
    const pending = b.status === "pending";
    const due = String(b.due_date ?? "").slice(0, 10);
    if (pending) {
      open += amount;
      if (due && due < today) overdue += amount;
    } else {
      paid += Number(b.paid_amount ?? b.amount) || 0;
    }
    const key = b.company_category_id ?? "__none__";
    const cur = byCat.get(key) ?? { open: 0, paid: 0 };
    if (pending) cur.open += amount;
    else cur.paid += Number(b.paid_amount ?? b.amount) || 0;
    byCat.set(key, cur);
  }

  return {
    title: "Resumo de vendas",
    slug: "resumo_vendas",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo)}`,
    ],
    tables: [
      {
        title: "Totais",
        columns: [
          { key: "label", header: "Indicador" },
          { key: "value", header: "Valor", format: "money", align: "right" },
        ],
        rows: [
          { label: "Em aberto", value: open },
          { label: "Vencido", value: overdue },
          { label: "Recebido", value: paid },
        ],
      },
      {
        title: "Por categoria",
        columns: [
          { key: "category", header: "Categoria" },
          { key: "open", header: "Em aberto", format: "money", align: "right" },
          { key: "paid", header: "Recebido", format: "money", align: "right" },
        ],
        rows: [...byCat.entries()].map(([id, agg]) => {
          const cat = id === "__none__" ? null : byId.get(id);
          return {
            category: cat ? companyCategoryDisplayName(cat) : "Sem categoria",
            open: agg.open,
            paid: agg.paid,
          };
        }),
      },
      {
        title: "Lançamentos",
        columns: [
          { key: "due_date", header: "Vencimento", format: "date" },
          { key: "description", header: "Descrição" },
          { key: "situation", header: "Situação" },
          { key: "amount", header: "Valor", format: "money", align: "right" },
        ],
        rows: filtered.map((b) => ({
          due_date: b.due_date,
          description: b.description,
          situation: boletoSituationLabel(b, today),
          amount: Number(b.amount) || 0,
        })),
      },
    ],
  };
}

export async function buildEpocBillingReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const rows = await fetchAllInRange<{
    faturamento_date: string;
    quantity: number | null;
    produtos: number | null;
    servicos: number | null;
    taxas: number | null;
    total: number | null;
    ticket_medio: number | null;
  }>(
    supabase
      .from("epoc_faturamento_daily")
      .select(
        "faturamento_date, quantity, produtos, servicos, taxas, total, ticket_medio",
      )
      .eq("company_id", ctx.companyId)
      .gte("faturamento_date", ctx.filters.dateFrom)
      .lte("faturamento_date", ctx.filters.dateTo)
      .order("faturamento_date", { ascending: true }),
  );

  return {
    title: "Faturamento EPOC",
    slug: "faturamento_epoc",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo)}`,
    ],
    tables: [
      {
        title: "Diário",
        columns: [
          { key: "date", header: "Dia", format: "date" },
          { key: "produtos", header: "Produtos", format: "money", align: "right" },
          { key: "servicos", header: "Serviços", format: "money", align: "right" },
          { key: "taxas", header: "Taxas", format: "money", align: "right" },
          { key: "total", header: "Total", format: "money", align: "right" },
          { key: "quantity", header: "Qtde", format: "number", align: "right" },
          {
            key: "ticket",
            header: "Ticket médio",
            format: "money",
            align: "right",
          },
        ],
        rows: rows.map((r) => ({
          date: r.faturamento_date,
          produtos: Number(r.produtos) || 0,
          servicos: Number(r.servicos) || 0,
          taxas: Number(r.taxas) || 0,
          total: Number(r.total) || 0,
          quantity: Number(r.quantity) || 0,
          ticket: Number(r.ticket_medio) || 0,
        })),
      },
    ],
  };
}

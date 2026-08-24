import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { periodLabel } from "../formatters";
import type { ReportResult, ReportRunContext } from "../types";

const TYPE_LABEL: Record<string, string> = {
  nota_fiscal: "Nota fiscal",
  romaneio: "Romaneio",
  recibo: "Recibo",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
};

export async function buildExpensesReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  let q = supabase
    .from("expenses")
    .select(
      "id, type, status, expense_source, supplier_name, invoice_number, supplier_document, reference_date, document_total, notes, created_at, boletos(id, status, amount, due_date)",
    )
    .eq("company_id", ctx.companyId)
    .gte("reference_date", ctx.filters.dateFrom)
    .lte("reference_date", ctx.filters.dateTo)
    .order("reference_date", { ascending: false });

  if (ctx.filters.expenseStatus !== "all") {
    q = q.eq("status", ctx.filters.expenseStatus);
  }
  if (ctx.filters.expenseOrigin !== "all") {
    q = q.eq("expense_source", ctx.filters.expenseOrigin);
  }
  const search = ctx.filters.search.trim();
  if (search) {
    const term = `%${search}%`;
    q = q.or(`supplier_name.ilike.${term},invoice_number.ilike.${term}`);
  }

  const rows = await fetchAllInRange<{
    type: string;
    status: string;
    expense_source?: string | null;
    supplier_name: string | null;
    invoice_number: string | null;
    supplier_document: string | null;
    reference_date: string | null;
    document_total: number | null;
    notes: string | null;
    boletos?:
      | { id: string; status: string; amount: number; due_date: string }[]
      | { id: string; status: string; amount: number; due_date: string }
      | null;
  }>(q);

  return {
    title: "Notas e recebimento",
    slug: "notas_recebimento",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo)}`,
    ],
    tables: [
      {
        title: "Notas",
        columns: [
          { key: "reference_date", header: "Competência", format: "date" },
          { key: "supplier", header: "Fornecedor" },
          { key: "document", header: "CNPJ/CPF" },
          { key: "invoice", header: "NF" },
          { key: "type", header: "Tipo" },
          { key: "status", header: "Status" },
          { key: "origin", header: "Origem" },
          { key: "total", header: "Total", format: "money", align: "right" },
          { key: "boleto", header: "Boleto" },
        ],
        rows: rows.map((e) => {
          const bol = Array.isArray(e.boletos) ? e.boletos[0] : e.boletos;
          return {
            reference_date: e.reference_date ?? "",
            supplier: e.supplier_name ?? "",
            document: e.supplier_document ?? "",
            invoice: e.invoice_number ?? "",
            type: TYPE_LABEL[e.type] ?? e.type,
            status: STATUS_LABEL[e.status] ?? e.status,
            origin: e.expense_source === "whatsapp" ? "WhatsApp" : "Manual",
            total: Number(e.document_total) || 0,
            boleto: bol
              ? `${bol.status === "paid" ? "Pago" : "Em aberto"}`
              : "Sem boleto",
          };
        }),
      },
    ],
  };
}

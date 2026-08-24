import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { periodLabel } from "../formatters";
import type { ReportResult, ReportRunContext } from "../types";

const STATUS_LABEL: Record<string, string> = {
  unmatched: "A conciliar",
  matched: "Conciliado",
  ignored: "Ignorado",
  created_payable: "Conta criada",
};

const DIR_LABEL: Record<string, string> = {
  debit: "Débito",
  credit: "Crédito",
};

export async function buildReconciliationReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  let q = supabase
    .from("bank_statement_lines")
    .select(
      "posted_at, amount, direction, description, status, company_bank_account_id, company_bank_accounts(name)",
    )
    .eq("company_id", ctx.companyId)
    .gte("posted_at", ctx.filters.dateFrom)
    .lte("posted_at", ctx.filters.dateTo)
    .order("posted_at", { ascending: true });

  if (ctx.filters.bankAccountId !== "all") {
    q = q.eq("company_bank_account_id", ctx.filters.bankAccountId);
  }
  if (ctx.filters.reconStatus !== "all") {
    q = q.eq("status", ctx.filters.reconStatus);
  }

  const rows = await fetchAllInRange<{
    posted_at: string;
    amount: number;
    direction: string;
    description: string;
    status: string;
    company_bank_accounts:
      | { name: string }
      | { name: string }[]
      | null;
  }>(q);

  return {
    title: "Conciliação bancária",
    slug: "conciliacao",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo)}`,
    ],
    tables: [
      {
        title: "Extrato",
        columns: [
          { key: "date", header: "Data", format: "date" },
          { key: "account", header: "Conta" },
          { key: "description", header: "Descrição" },
          { key: "direction", header: "Direção" },
          { key: "amount", header: "Valor", format: "money", align: "right" },
          { key: "status", header: "Situação" },
        ],
        rows: rows.map((r) => {
          const acc = Array.isArray(r.company_bank_accounts)
            ? r.company_bank_accounts[0]
            : r.company_bank_accounts;
          return {
            date: String(r.posted_at).slice(0, 10),
            account: acc?.name ?? "",
            description: r.description,
            direction: DIR_LABEL[r.direction] ?? r.direction,
            amount: Number(r.amount) || 0,
            status: STATUS_LABEL[r.status] ?? r.status,
          };
        }),
      },
    ],
  };
}

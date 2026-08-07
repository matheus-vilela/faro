import { calendarDaysFromTodayToDueDate } from "@/lib/companyAlerts/dueDateWindow";
import { supabase } from "@/lib/supabase";
import type { ExpectedCompanyAlert } from "@/types/companyAlert";
import type { Product } from "@/types/product";

/**
 * Calcula o conjunto de alertas que devem existir para a empresa,
 * com base nas mesmas regras da antiga tela de alertas (consultas ao banco).
 */
export async function computeExpectedCompanyAlerts(
  companyId: string,
): Promise<ExpectedCompanyAlert[]> {
  const out: ExpectedCompanyAlert[] = [];

  const { data: productsData } = await supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .gt("min_quantity", 0);

  const products = (productsData ?? []) as Product[];
  for (const p of products) {
    if (p.is_active === false) continue;
    if (Number(p.current_quantity) > Number(p.min_quantity)) continue;
    out.push({
      dedupe_key: `low_stock:${p.id}`,
      kind: "low_stock",
      severity: "danger",
      title: `Estoque baixo: ${p.name}`,
      message: `${Number(p.current_quantity).toLocaleString("pt-BR")} / ${Number(p.min_quantity).toLocaleString("pt-BR")} ${p.unit}`,
      link_path: "/app/produtos",
      payload: {
        product_id: p.id,
        product_name: p.name,
        sku: p.sku ?? null,
        current_quantity: p.current_quantity,
        min_quantity: p.min_quantity,
        unit: p.unit,
      },
    });
  }

  const { data: expensesData } = await supabase
    .from("expenses")
    .select(
      "id, supplier_name, display_name, invoice_number, created_at, expense_source, status",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  const { data: boletosData } = await supabase
    .from("boletos")
    .select("expense_id")
    .eq("company_id", companyId)
    .eq("flow_type", "payable")
    .not("expense_id", "is", null);

  const linkedExpenseIds = new Set(
    (boletosData ?? []).map((b) => b.expense_id).filter(Boolean) as string[],
  );

  for (const e of expensesData ?? []) {
    const row = e as {
      id: string;
      expense_source?: string | null;
      status?: string | null;
      supplier_name: string | null;
      display_name: string | null;
      invoice_number: string | null;
      created_at: string;
    };
    if (row.expense_source === "whatsapp" && row.status === "pending") {
      continue;
    }
    if (linkedExpenseIds.has(row.id)) continue;

    const label =
      row.display_name?.trim() || row.supplier_name?.trim() || "Sem fornecedor";
    const note = row.invoice_number
      ? `Nota ${row.invoice_number} · ${new Date(row.created_at).toLocaleDateString("pt-BR")}`
      : new Date(row.created_at).toLocaleDateString("pt-BR");

    out.push({
      dedupe_key: `expense_no_boleto:${row.id}`,
      kind: "expense_no_boleto",
      severity: "warning",
      title: "Despesa sem boleto vinculado",
      message: `${label} — ${note}`,
      link_path: `/app/notas-recebimento?expense=${row.id}`,
      payload: {
        expense_id: row.id,
        display_name: row.display_name,
        supplier_name: row.supplier_name,
        invoice_number: row.invoice_number,
      },
    });
  }

  const { data: payableBoletos } = await supabase
    .from("boletos")
    .select("id, description, due_date, amount, expense_id")
    .eq("company_id", companyId)
    .eq("flow_type", "payable")
    .eq("exclude_from_fluxo", false)
    .neq("entry_kind", "transfer")
    .eq("status", "pending");

  const money = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(n);

  for (const b of payableBoletos ?? []) {
    const row = b as {
      id: string;
      description: string;
      due_date: string;
      amount: number;
      expense_id: string | null;
    };
    const days = calendarDaysFromTodayToDueDate(row.due_date);
    if (days !== 1 && days !== 3) continue;

    const dueLabel = new Date(
      row.due_date.slice(0, 10) + "T12:00:00",
    ).toLocaleDateString("pt-BR");
    const baseMsg = `${row.description.trim() || "Conta a pagar"} · ${money(Number(row.amount))} · venc. ${dueLabel}`;

    if (days === 3) {
      out.push({
        dedupe_key: `boleto_vencimento_d3:${row.id}`,
        kind: "boleto_vencimento_d3",
        severity: "warning",
        title: "Boleto vence em 3 dias",
        message: baseMsg,
        link_path: row.expense_id
          ? `/app/notas-recebimento?expense=${row.expense_id}`
          : "/app/contas-a-pagar",
        payload: {
          boleto_id: row.id,
          due_date: row.due_date,
          amount: row.amount,
          expense_id: row.expense_id,
          window: "d3",
        },
      });
    } else {
      out.push({
        dedupe_key: `boleto_vencimento_d1:${row.id}`,
        kind: "boleto_vencimento_d1",
        severity: "danger",
        title: "Boleto vence amanhã (D-1)",
        message: baseMsg,
        link_path: row.expense_id
          ? `/app/notas-recebimento?expense=${row.expense_id}`
          : "/app/contas-a-pagar",
        payload: {
          boleto_id: row.id,
          due_date: row.due_date,
          amount: row.amount,
          expense_id: row.expense_id,
          window: "d1",
        },
      });
    }
  }

  const { data: notReceivedData } = await supabase
    .from("recebimento_item_status")
    .select(
      `
          id,
          recebimento_id,
          expense_item_id,
          quantity_received,
          status,
          recebimentos!inner (
            expense_id,
            received_at,
            expenses!inner (
              supplier_name,
              display_name,
              invoice_number,
              company_id
            )
          ),
          expense_items!inner (
            product_name,
            quantity
          )
        `,
    )
    .in("status", ["not_received", "partial"]);

  for (const r of notReceivedData ?? []) {
    const rec = r as unknown as {
      id: string;
      recebimento_id: string;
      expense_item_id: string;
      quantity_received: number | null;
      expense_items:
        | { product_name: string; quantity: number }
        | { product_name: string; quantity: number }[];
      recebimentos:
        | {
            expense_id: string;
            received_at: string | null;
            expenses:
              | {
                  supplier_name: string | null;
                  display_name: string | null;
                  invoice_number: string | null;
                  company_id: string;
                }
              | {
                  supplier_name: string | null;
                  display_name: string | null;
                  invoice_number: string | null;
                  company_id: string;
                }[];
          }
        | {
            expense_id: string;
            received_at: string | null;
            expenses:
              | {
                  supplier_name: string | null;
                  display_name: string | null;
                  invoice_number: string | null;
                  company_id: string;
                }
              | {
                  supplier_name: string | null;
                  display_name: string | null;
                  invoice_number: string | null;
                  company_id: string;
                }[];
          }[];
    };
    const rb = Array.isArray(rec.recebimentos)
      ? rec.recebimentos[0]
      : rec.recebimentos;
    const exp =
      rb && (Array.isArray(rb.expenses) ? rb.expenses[0] : rb.expenses);
    if (!exp || exp.company_id !== companyId) continue;
    const ei = Array.isArray(rec.expense_items)
      ? rec.expense_items[0]
      : rec.expense_items;
    const ordered = Number(ei?.quantity ?? 0);
    const qRec =
      rec.quantity_received != null ? Number(rec.quantity_received) : 0;
    const missing = Math.max(0, ordered - qRec);
    if (missing <= 0) continue;

    const supplier =
      exp.display_name?.trim() || exp.supplier_name || "Sem fornecedor";
    const nota = exp.invoice_number ? `Nota ${exp.invoice_number}` : "";

    out.push({
      dedupe_key: `recebimento_falta:${rec.id}`,
      kind: "recebimento_falta",
      severity: "danger",
      title: `Falta no recebimento: ${ei?.product_name ?? "—"}`,
      message: [
        `Faltam ${missing.toLocaleString("pt-BR")} un.`,
        `Pedido ${ordered.toLocaleString("pt-BR")} un., recebido ${qRec.toLocaleString("pt-BR")} un.`,
        supplier,
        nota,
      ]
        .filter(Boolean)
        .join(" · "),
      link_path: `/app/notas-recebimento?expense=${rb.expense_id}`,
      payload: {
        recebimento_item_status_id: rec.id,
        recebimento_id: rec.recebimento_id,
        expense_id: rb.expense_id,
        expense_item_id: rec.expense_item_id,
        product_name: ei?.product_name ?? null,
        quantity_ordered: ordered,
        quantity_received: qRec,
        quantity_missing: missing,
      },
    });
  }

  const { count: pendingImportCount } = await supabase
    .from("import_review_pending")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "OPEN");
  if ((pendingImportCount ?? 0) > 0) {
    out.push({
      dedupe_key: "import_pending_review_open",
      kind: "import_pending_review",
      severity: "warning",
      title: "Pendências da importação XML",
      message: `${pendingImportCount} item(ns) precisam de revisão operacional.`,
      link_path: "/app",
      payload: {
        open_pending_count: pendingImportCount,
      },
    });
  }

  return out;
}

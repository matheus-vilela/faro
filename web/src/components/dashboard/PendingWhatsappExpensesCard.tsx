import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { ExpenseLauncherInfo } from "@/components/expenses/ExpenseLauncherInfo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { Expense } from "@/types/expense";
import { Loader2, MessageCircle, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export function PendingWhatsappExpensesCard() {
  const { currentCompany, currentRole } = useCompany();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<
    Pick<
      Expense,
      "id" | "supplier_name" | "created_at" | "expense_items"
    >[]
  >([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [sheetExpenseId, setSheetExpenseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompany?.id || !currentRole || !canOwnerAccess(currentRole)) {
      setLoading(false);
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("expenses")
      .select(
        "id, supplier_name, created_at, expense_items (quantity, unit_value)",
      )
      .eq("company_id", currentCompany.id)
      .eq("expense_source", "whatsapp")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(8);
    setLoading(false);
    if (error) {
      setItems([]);
      return;
    }
    setItems(
      (data ?? []) as Pick<
        Expense,
        "id" | "supplier_name" | "created_at" | "expense_items"
      >[],
    );
  }, [currentCompany?.id, currentRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setApprovingId(id);
    const { data, error } = await supabase.rpc(
      "approve_whatsapp_expense_as_owner",
      { p_expense_id: id },
    );
    setApprovingId(null);
    if (error) {
      toast.error(error.message ?? "Não foi possível aprovar");
      return;
    }
    const res = data as { success?: boolean; error?: string };
    if (!res?.success) {
      toast.error(res?.error ?? "Não foi possível aprovar");
      return;
    }
    toast.success("Despesa aprovada.");
    void load();
  };

  if (!currentRole || !canOwnerAccess(currentRole)) {
    return null;
  }

  return (
    <>
    <ExpenseDetailSheet
      expenseId={sheetExpenseId}
      onClose={() => setSheetExpenseId(null)}
      onRefresh={() => void load()}
    />
    <Card className="border-amber-500/25">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Despesas WhatsApp</CardTitle>
              <CardDescription>
                Importações aguardando sua aprovação para liberar recebimento
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link to="/app/despesas">
              Ver despesas
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">
            Nenhuma despesa do WhatsApp pendente de aprovação.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((row) => {
              const total =
                row.expense_items?.reduce(
                  (s, it) =>
                    s + Number(it.quantity) * Number(it.unit_value),
                  0,
                ) ?? 0;
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {row.supplier_name ?? "Fornecedor"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {formatBrl(total)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quem lançou:{" "}
                      <ExpenseLauncherInfo
                        expenseId={row.id}
                        compact
                        className="inline"
                      />
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setSheetExpenseId(row.id)}
                    >
                      Abrir
                    </Button>
                    <Button
                      size="sm"
                      disabled={approvingId === row.id}
                      onClick={() => void approve(row.id)}
                    >
                      {approvingId === row.id ? "…" : "Aprovar"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
    </>
  );
}

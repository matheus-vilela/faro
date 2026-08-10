import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import {
  toneDotClass,
  type HomeActionItem,
} from "@/lib/dashboardHomeActions";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export function DashboardNeedsYouQueue({
  items,
  loading,
  onChanged,
}: {
  items: HomeActionItem[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [sheetExpenseId, setSheetExpenseId] = useState<string | null>(null);

  const approve = async (expenseId: string) => {
    setApprovingId(expenseId);
    const { data, error } = await supabase.rpc(
      "approve_whatsapp_expense_as_owner",
      { p_expense_id: expenseId },
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
    onChanged();
  };

  return (
    <>
      <ExpenseDetailSheet
        expenseId={sheetExpenseId}
        onClose={() => setSheetExpenseId(null)}
        onRefresh={onChanged}
      />
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <CardTitle className="text-base font-semibold sm:text-lg">
              Precisa de você
            </CardTitle>
            {!loading && items.length > 0 ? (
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold text-primary">
                {items.length}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando pendências…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-semibold text-foreground">
                Tudo em dia
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Nenhuma pendência agora. Eu te aviso quando surgir algo.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 px-3.5 py-3"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      toneDotClass(item.tone),
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.secondary ? (
                      item.secondary.href ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={item.secondary.href}>
                            {item.secondary.label}
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (
                              item.secondary?.action === "open_whatsapp" &&
                              item.secondary.expenseId
                            ) {
                              setSheetExpenseId(item.secondary.expenseId);
                            }
                          }}
                        >
                          {item.secondary.label}
                        </Button>
                      )
                    ) : null}
                    {item.primary.href ? (
                      <Button size="sm" asChild>
                        <Link to={item.primary.href}>{item.primary.label}</Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={
                          approvingId != null &&
                          approvingId === item.primary.expenseId
                        }
                        onClick={() => {
                          if (
                            item.primary.action === "approve_whatsapp" &&
                            item.primary.expenseId
                          ) {
                            void approve(item.primary.expenseId);
                          }
                        }}
                      >
                        {approvingId === item.primary.expenseId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          item.primary.label
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

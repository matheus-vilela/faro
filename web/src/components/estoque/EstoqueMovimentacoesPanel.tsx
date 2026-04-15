import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { ArrowDownLeft, ArrowUpRight, Loader2, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  created_at: string;
  unit_cost: number | null;
  products: { name: string; unit: string } | null;
};

const REF_LABEL: Record<string, string> = {
  inventory_count: "Contagem",
  expense: "Despesa",
  expense_item: "Despesa",
  recebimento: "Recebimento",
  recipe: "Receita",
  revenue_entry: "Venda",
  waste: "Perda",
  adjustment: "Ajuste",
  purchase_order: "Compra",
};

function refLabel(t: string | null): string {
  if (!t) return "—";
  return REF_LABEL[t] ?? t;
}

export function EstoqueMovimentacoesPanel({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stock_movements")
      .select(
        "id, quantity, type, reference_type, created_at, unit_cost, products!inner(name, unit, company_id)",
      )
      .eq("products.company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(250);

    setLoading(false);
    if (error) {
      console.error(error);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Row[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const formatMoney = (v: number | null) =>
    v == null || Number.isNaN(v)
      ? "—"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(v);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="h-4 w-4" />
          Movimentações de estoque
        </CardTitle>
        <CardDescription>
          Histórico de entradas, saídas e ajustes vinculados aos produtos da
          empresa (últimos registros).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma movimentação registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="p-2 font-medium">Data</th>
                  <th className="p-2 font-medium">Produto</th>
                  <th className="p-2 font-medium">Tipo</th>
                  <th className="p-2 font-medium">Qtd</th>
                  <th className="p-2 font-medium">Ref.</th>
                  <th className="p-2 font-medium">Custo un.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const name = r.products?.name ?? "—";
                  const unit = r.products?.unit ?? "";
                  const isIn = r.type === "in";
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-2 font-medium">{name}</td>
                      <td className="p-2">
                        <Badge
                          variant={isIn ? "secondary" : "outline"}
                          className="gap-1 font-normal"
                        >
                          {isIn ? (
                            <ArrowDownLeft className="h-3 w-3" />
                          ) : (
                            <ArrowUpRight className="h-3 w-3" />
                          )}
                          {isIn ? "Entrada" : "Saída"}
                        </Badge>
                      </td>
                      <td className="p-2 tabular-nums">
                        {Number(r.quantity).toLocaleString("pt-BR")} {unit}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {refLabel(r.reference_type)}
                      </td>
                      <td className="p-2 tabular-nums text-muted-foreground">
                        {formatMoney(
                          r.unit_cost != null ? Number(r.unit_cost) : null,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

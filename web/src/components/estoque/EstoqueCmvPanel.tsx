import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { Coins, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export function EstoqueCmvPanel({ companyId }: { companyId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .or("is_active.is.null,is_active.eq.true")
      .order("name");
    setLoading(false);
    if (error) {
      console.error(error);
      setProducts([]);
      return;
    }
    setProducts((data ?? []) as Product[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const formatMoney = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const totals = useMemo(() => {
    let stockValue = 0;
    for (const p of products) {
      const q = Number(p.current_quantity);
      const cost =
        p.average_cost != null && p.average_cost > 0
          ? Number(p.average_cost)
          : p.last_unit_value != null && p.last_unit_value > 0
            ? Number(p.last_unit_value)
            : 0;
      stockValue += q * cost;
    }
    return { stockValue };
  }, [products]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4" />
          CMV e valor em estoque
        </CardTitle>
        <CardDescription>
          O custo médio ponderado é atualizado nas entradas de estoque com valor
          unitário (ex.: despesas e recebimentos). O valor em estoque usa CMV
          ou, na falta, o último preço pago.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Valor estimado em estoque: </span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatMoney(totals.stockValue)}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto ativo.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="p-2 font-medium">Produto</th>
                  <th className="p-2 font-medium">Qtd</th>
                  <th className="p-2 font-medium">CMV / último</th>
                  <th className="p-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const q = Number(p.current_quantity);
                  const cmv =
                    p.average_cost != null && p.average_cost > 0
                      ? Number(p.average_cost)
                      : null;
                  const last =
                    p.last_unit_value != null && p.last_unit_value > 0
                      ? Number(p.last_unit_value)
                      : null;
                  const unitCost = cmv ?? last ?? 0;
                  const lineVal = q * unitCost;
                  return (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="p-2 font-medium">{p.name}</td>
                      <td className="p-2 tabular-nums">
                        {q.toLocaleString("pt-BR")} {p.unit}
                      </td>
                      <td className="p-2 tabular-nums text-muted-foreground">
                        {cmv != null ? (
                          <span>{formatMoney(cmv)}/{p.unit}</span>
                        ) : last != null ? (
                          <span>últ. {formatMoney(last)}/{p.unit}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2 tabular-nums">
                        {unitCost > 0 ? formatMoney(lineVal) : "—"}
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

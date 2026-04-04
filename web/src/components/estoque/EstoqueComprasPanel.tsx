import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type OrderRow = {
  id: string;
  status: string;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  suppliers: { name: string } | null;
};

type LineDraft = { product_id: string; quantity: string; unit_value: string };

export function EstoqueComprasPanel({ companyId }: { companyId: string }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { product_id: "", quantity: "1", unit_value: "" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [o, p, s] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, status, expected_date, notes, created_at, suppliers(name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name"),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name"),
    ]);
    setLoading(false);
    if (o.error) console.error(o.error);
    setOrders((o.data ?? []) as unknown as OrderRow[]);
    setProducts((p.data ?? []) as Product[]);
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const statusLabel = (s: string) => {
    const m: Record<string, string> = {
      draft: "Rascunho",
      ordered: "Pedido",
      received: "Recebido",
      cancelled: "Cancelado",
    };
    return m[s] ?? s;
  };

  const saveOrder = async () => {
    const validLines = lines.filter(
      (l) =>
        l.product_id &&
        parseFloat(l.quantity) > 0 &&
        !Number.isNaN(parseFloat(l.quantity)),
    );
    if (validLines.length === 0) {
      toast.error("Adicione ao menos um item com produto e quantidade.");
      return;
    }
    setSaving(true);
    const { data: ord, error: oe } = await supabase
      .from("purchase_orders")
      .insert({
        company_id: companyId,
        supplier_id: supplierId || null,
        status: "draft",
        expected_date: expectedDate || null,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (oe || !ord?.id) {
      console.error(oe);
      toast.error("Não foi possível criar o pedido.");
      setSaving(false);
      return;
    }

    const oid = ord.id as string;
    const rows = validLines.map((l) => ({
      order_id: oid,
      product_id: l.product_id,
      quantity: parseFloat(l.quantity),
      unit_value:
        l.unit_value.trim() !== "" && !Number.isNaN(parseFloat(l.unit_value))
          ? parseFloat(l.unit_value)
          : null,
    }));

    const { error: ie } = await supabase
      .from("purchase_order_items")
      .insert(rows);

    setSaving(false);
    if (ie) {
      console.error(ie);
      toast.error("Pedido criado, mas falhou ao salvar itens.");
      void load();
      return;
    }
    toast.success("Pedido de compra registrado.");
    setSheetOpen(false);
    setSupplierId("");
    setExpectedDate("");
    setNotes("");
    setLines([{ product_id: "", quantity: "1", unit_value: "" }]);
    void load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4" />
            Pedidos de compra
          </CardTitle>
          <CardDescription>
            Registre pedidos planejados (fornecedor, previsão e itens). Ao
            receber a mercadoria, confira no recebimento ou na despesa para
            atualizar estoque e CMV.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={() => setSheetOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Novo pedido
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum pedido cadastrado.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {o.suppliers?.name ?? "Sem fornecedor"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(o.status)}
                    {o.expected_date
                      ? ` · prev. ${new Date(o.expected_date + "T12:00:00").toLocaleDateString("pt-BR")}`
                      : ""}
                    {" · "}
                    {new Date(o.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Novo pedido de compra</SheetTitle>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 px-4 pb-2">
            <div className="space-y-2">
              <Label>Fornecedor (opcional)</Label>
              <Select
                value={supplierId || "__none__"}
                onValueChange={(v) =>
                  setSupplierId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Previsão (opcional)</Label>
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Pedido #, contato…"
              />
            </div>
            <div className="space-y-2">
              <Label>Itens</Label>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-end"
                  >
                    <div className="flex-1 space-y-1">
                      <Select
                        value={l.product_id || "__pick__"}
                        onValueChange={(v) => {
                          const next = [...lines];
                          next[i] =
                            v === "__pick__"
                              ? { ...next[i]!, product_id: "" }
                              : { ...next[i]!, product_id: v };
                          setLines(next);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Produto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__pick__">—</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      className="w-full sm:w-24"
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="Qtd"
                      value={l.quantity}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i]!, quantity: e.target.value };
                        setLines(next);
                      }}
                    />
                    <Input
                      className="w-full sm:w-28"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="R$ un."
                      value={l.unit_value}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i]!, unit_value: e.target.value };
                        setLines(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((p) => [
                    ...p,
                    { product_id: "", quantity: "1", unit_value: "" },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Linha
              </Button>
            </div>
          </div>
          <SheetFooter className="gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void saveOrder()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

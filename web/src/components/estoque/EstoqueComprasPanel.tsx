import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  AlertTriangle,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type OrderItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_value: number | null;
  input_quantity: number | null;
  input_unit_code: string | null;
};

type OrderRow = {
  id: string;
  supplier_id: string | null;
  status: string;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  purchase_order_items?: OrderItemRow[];
};

const OPEN_PO_STATUSES = new Set(["draft", "ordered"]);

function orderItemsLineTotal(it: OrderItemRow): number {
  const uv = it.unit_value != null ? Number(it.unit_value) : NaN;
  if (!Number.isFinite(uv) || uv === 0) return 0;
  const q = Number(it.input_quantity ?? it.quantity ?? 0);
  if (!Number.isFinite(q)) return 0;
  return q * uv;
}

function orderListSummary(o: OrderRow): {
  itemCount: number;
  totalValue: number;
  hasPricedLines: boolean;
} {
  const items = o.purchase_order_items ?? [];
  let totalValue = 0;
  let hasPricedLines = false;
  for (const it of items) {
    const uv = it.unit_value != null ? Number(it.unit_value) : NaN;
    if (Number.isFinite(uv) && uv > 0) {
      hasPricedLines = true;
      totalValue += orderItemsLineTotal(it);
    }
  }
  return { itemCount: items.length, totalValue, hasPricedLines };
}

function productStockSortKey(p: Product): number {
  const q = Number(p.current_quantity);
  const min = Number(p.min_quantity ?? 0);
  const isZero = p.stock_is_zero ?? q <= 0;
  if (isZero) return 0;
  const belowMin =
    p.stock_below_min_positive ?? (min > 0 && q > 0 && q <= min);
  if (belowMin) return 1;
  return 2;
}

/** Alinhado ao catálogo: zerado tem prioridade sobre “abaixo do mínimo”. */
function productStockFlags(p: Product): {
  stockIsZero: boolean;
  stockBelowMinPositive: boolean;
} {
  const q = Number(p.current_quantity);
  const min = Number(p.min_quantity ?? 0);
  const stockIsZero = p.stock_is_zero ?? q <= 0;
  const stockBelowMinPositive =
    p.stock_below_min_positive ?? (min > 0 && q > 0 && q <= min);
  return {
    stockIsZero,
    stockBelowMinPositive: !stockIsZero && stockBelowMinPositive,
  };
}

type LineDraft = {
  product_id: string;
  quantity: string;
  unit_value: string;
  unit_code: string;
};

function ProductPicker({
  products,
  value,
  onChange,
  placeholder = "Produto",
  showOpenOrderHint,
}: {
  products: Product[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  showOpenOrderHint?: (productId: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);
  const selected = products.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) => p.name.toLowerCase().includes(t));
  }, [products, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto..."
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {filtered.map((p) => {
            const { stockIsZero, stockBelowMinPositive } = productStockFlags(p);
            return (
              <button
                key={p.id}
                type="button"
                className={cn(
                  "w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                  value === p.id && "bg-accent/80",
                )}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="block font-medium leading-snug">{p.name}</span>
                {(stockIsZero || stockBelowMinPositive) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {stockIsZero ? (
                      <Badge
                        variant="destructive"
                        className="h-5 gap-0.5 px-1.5 py-0 text-[0.65rem] font-normal"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Sem estoque
                      </Badge>
                    ) : null}
                    {stockBelowMinPositive ? (
                      <Badge
                        variant="secondary"
                        className="h-5 gap-0.5 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[0.65rem] font-normal text-amber-950 dark:text-amber-50"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Abaixo do mínimo
                      </Badge>
                    ) : null}
                  </div>
                )}
                {showOpenOrderHint?.(p.id) ? (
                  <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                    Já em outro pedido em andamento
                  </span>
                ) : null}
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EstoqueComprasPanel({ companyId }: { companyId: string }) {
  const formatCurrencyInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    const cents = Number(digits) / 100;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents);
  };
  const parseCurrencyInput = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    return Number(digits) / 100;
  };
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<"summary" | "edit">("edit");
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { product_id: "", quantity: "1", unit_value: "", unit_code: "" },
  ]);
  const [duplicateDialog, setDuplicateDialog] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [o, p, s, c] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          `
          id,
          supplier_id,
          status,
          expected_date,
          notes,
          created_at,
          suppliers(name),
          purchase_order_items(
            id,
            product_id,
            quantity,
            unit_value,
            input_quantity,
            input_unit_code
          )
        `,
        )
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
      supabase.from("product_unit_conversions").select("*").eq("company_id", companyId),
    ]);
    setLoading(false);
    if (o.error) console.error(o.error);
    setOrders((o.data ?? []) as unknown as OrderRow[]);
    setProducts((p.data ?? []) as Product[]);
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
    setProductConversions((c.data ?? []) as ProductUnitConversionDraft[]);
  }, [companyId]);

  const formatBRL = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const conversionsByProduct = useMemo(() => {
    const out = new Map<string, ProductUnitConversionDraft[]>();
    for (const row of productConversions) {
      if (!row.product_id) continue;
      const prev = out.get(row.product_id) ?? [];
      prev.push(row);
      out.set(row.product_id, prev);
    }
    return out;
  }, [productConversions]);
  const allowedUnitsForProduct = useCallback(
    (productId: string): string[] => {
      const product = productById.get(productId);
      if (!product) return [];
      const base = product.unit;
      const allowed = new Set<string>([base]);
      const convs = conversionsByProduct.get(productId) ?? [];
      for (const c of convs) {
        if (c.primary_unit_code?.trim().toLowerCase() === base.trim().toLowerCase()) {
          allowed.add(c.secondary_unit_code);
        }
      }
      for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
        if (candidate.toLowerCase() === base.trim().toLowerCase()) continue;
        if (getLockedSystemSecondaryQty(1, base, candidate) != null) {
          allowed.add(candidate);
        }
      }
      return [...allowed];
    },
    [conversionsByProduct, productById],
  );
  const toBaseQty = useCallback(
    (productId: string, qty: number, fromUnit: string): number | null => {
      const product = productById.get(productId);
      if (!product) return null;
      const convs = (conversionsByProduct.get(productId) ?? []).map((r) => ({
        primary_unit_code: r.primary_unit_code,
        secondary_unit_code: r.secondary_unit_code,
        primary_qty: Number(r.primary_qty),
        secondary_qty: Number(r.secondary_qty),
      }));
      const raw = convertQuantityForProduct(
        qty,
        fromUnit,
        product.unit,
        product.unit,
        convs,
      );
      return raw == null ? null : roundHubQuantityForStock(raw);
    },
    [conversionsByProduct, productById],
  );

  const productsSortedForPicker = useMemo(() => {
    return [...products].sort((a, b) => {
      const ka = productStockSortKey(a);
      const kb = productStockSortKey(b);
      if (ka !== kb) return ka - kb;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [products]);

  const { zeroStockCount, alertStockCount, openPurchaseOrderCount } = useMemo(() => {
    let zero = 0;
    let alert = 0;
    for (const p of products) {
      const q = Number(p.current_quantity);
      const min = Number(p.min_quantity ?? 0);
      const isZero = p.stock_is_zero ?? q <= 0;
      const belowMinPos =
        p.stock_below_min_positive ?? (min > 0 && q > 0 && q <= min);
      if (isZero) zero++;
      else if (belowMinPos) alert++;
    }
    const openPurchaseOrderCount = orders.filter((o) =>
      OPEN_PO_STATUSES.has(o.status),
    ).length;
    return { zeroStockCount: zero, alertStockCount: alert, openPurchaseOrderCount };
  }, [products, orders]);

  const openOrdersByProduct = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of orders) {
      if (!OPEN_PO_STATUSES.has(o.status)) continue;
      for (const it of o.purchase_order_items ?? []) {
        const pid = it.product_id;
        const arr = m.get(pid) ?? [];
        arr.push(o.id);
        m.set(pid, arr);
      }
    }
    return m;
  }, [orders]);

  const productHasOtherOpenOrder = useCallback(
    (productId: string) => {
      const ids = openOrdersByProduct.get(productId) ?? [];
      return ids.some((oid) => oid !== editingOrderId);
    },
    [openOrdersByProduct, editingOrderId],
  );

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

  const collectDuplicateProductNames = (validLines: LineDraft[]) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const l of validLines) {
      if (!l.product_id || !productHasOtherOpenOrder(l.product_id)) continue;
      if (seen.has(l.product_id)) continue;
      seen.add(l.product_id);
      names.push(productById.get(l.product_id)?.name ?? "Produto");
    }
    return names;
  };

  const saveOrder = async (opts?: { skipDuplicateCheck?: boolean }) => {
    const validLines = lines.filter((l) => l.product_id && l.unit_code && l.quantity.trim() !== "");
    if (validLines.length === 0) {
      toast.error("Adicione ao menos um item com produto e quantidade.");
      return;
    }
    if (!opts?.skipDuplicateCheck) {
      const dups = collectDuplicateProductNames(validLines);
      if (dups.length > 0) {
        setDuplicateDialog(dups);
        return;
      }
    } else {
      setDuplicateDialog(null);
    }
    setSaving(true);
    let oid = editingOrderId;
    if (editingOrderId) {
      const { error: upErr } = await supabase
        .from("purchase_orders")
        .update({
          supplier_id: supplierId || null,
          expected_date: expectedDate || null,
          notes: notes.trim() || null,
        })
        .eq("id", editingOrderId);
      if (upErr) {
        console.error(upErr);
        toast.error("Não foi possível atualizar o pedido.");
        setSaving(false);
        return;
      }
      const { error: delErr } = await supabase
        .from("purchase_order_items")
        .delete()
        .eq("order_id", editingOrderId);
      if (delErr) {
        console.error(delErr);
        toast.error("Não foi possível atualizar os itens do pedido.");
        setSaving(false);
        return;
      }
    } else {
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
      oid = ord.id as string;
    }
    if (!oid) {
      toast.error("Pedido inválido.");
      setSaving(false);
      return;
    }
    const rows = validLines.map((l) => {
      const qty = parseFloat(l.quantity.replace(",", "."));
      const baseQty = toBaseQty(l.product_id, qty, l.unit_code);
      return {
        company_id: companyId,
        order_id: oid,
        product_id: l.product_id,
        quantity: baseQty ?? qty,
        input_quantity: qty,
        input_unit_code: l.unit_code,
        unit_value: parseCurrencyInput(l.unit_value),
      };
    });

    const { error: ie } = await supabase
      .from("purchase_order_items")
      .insert(rows);

    setSaving(false);
    if (ie) {
      console.error(ie);
      toast.error("Pedido salvo, mas falhou ao salvar itens.");
      void load();
      return;
    }
    toast.success(editingOrderId ? "Pedido atualizado." : "Pedido de compra registrado.");
    setDuplicateDialog(null);
    setSheetOpen(false);
    setEditingOrderId(null);
    setSupplierId("");
    setExpectedDate("");
    setNotes("");
    setLines([{ product_id: "", quantity: "1", unit_value: "", unit_code: "" }]);
    void load();
  };

  const openEditOrder = async (o: OrderRow) => {
    setEditingOrderId(o.id);
    setSupplierId(o.supplier_id ?? "");
    setExpectedDate(o.expected_date ?? "");
    setNotes(o.notes ?? "");
    const { data: items, error } = await supabase
      .from("purchase_order_items")
      .select("product_id, quantity, input_quantity, input_unit_code, unit_value")
      .eq("order_id", o.id);
    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar os itens do pedido.");
      return;
    }
    setLines(
      (items ?? []).map((i) => ({
        product_id: i.product_id,
        quantity: String(Number(i.input_quantity ?? i.quantity)),
        unit_code: i.input_unit_code ?? products.find((p) => p.id === i.product_id)?.unit ?? "",
        unit_value:
          i.unit_value != null && !Number.isNaN(Number(i.unit_value))
            ? formatCurrencyInput(String(Math.round(Number(i.unit_value) * 100)))
            : "",
      })),
    );
    setSheetMode("summary");
    setSheetOpen(true);
  };

  const deleteOrder = async () => {
    if (!editingOrderId) return;
    setSaving(true);
    const { error } = await supabase.from("purchase_orders").delete().eq("id", editingOrderId);
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível excluir o pedido.");
      return;
    }
    toast.success("Pedido excluído.");
    setSheetOpen(false);
    setEditingOrderId(null);
    setSupplierId("");
    setExpectedDate("");
    setNotes("");
    setLines([{ product_id: "", quantity: "1", unit_value: "", unit_code: "" }]);
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
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditingOrderId(null);
            setSheetMode("edit");
            setSupplierId("");
            setExpectedDate("");
            setNotes("");
            setLines([{ product_id: "", quantity: "1", unit_value: "", unit_code: "" }]);
            setSheetOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Novo pedido
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3 shadow-sm dark:bg-red-500/[0.12]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-red-900/80 dark:text-red-100/85">
                Sem estoque
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-red-950 dark:text-red-50">
                {zeroStockCount}
              </p>
              <p className="mt-0.5 text-xs text-red-900/70 dark:text-red-100/70">
                Produtos zerados
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-4 py-3 shadow-sm dark:bg-amber-500/[0.12]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-amber-950/80 dark:text-amber-50/90">
                Em alerta
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
                {alertStockCount}
              </p>
              <p className="mt-0.5 text-xs text-amber-950/70 dark:text-amber-50/75">
                Abaixo do mínimo (com estoque)
              </p>
            </div>
            <div className="rounded-xl border border-blue-500/35 bg-blue-500/[0.07] px-4 py-3 shadow-sm dark:bg-blue-500/[0.14]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-blue-950/80 dark:text-blue-50/90">
                Pedidos em andamento
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-blue-950 dark:text-blue-50">
                {openPurchaseOrderCount}
              </p>
              <p className="mt-0.5 text-xs text-blue-950/70 dark:text-blue-50/75">
                Rascunho ou pedido enviado
              </p>
            </div>
          </div>
        ) : null}
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
          <ul className="space-y-3">
            {orders.map((o) => {
              const { itemCount, totalValue, hasPricedLines } = orderListSummary(o);
              const prevLabel = o.expected_date
                ? new Date(o.expected_date + "T12:00:00").toLocaleDateString("pt-BR")
                : null;
              return (
              <li
                key={o.id}
                role="button"
                tabIndex={0}
                onClick={() => void openEditOrder(o)}
                onKeyDown={(e) => e.key === "Enter" && void openEditOrder(o)}
                className="cursor-pointer rounded-2xl border border-border/80 bg-gradient-to-br from-card to-muted/30 p-4 text-sm shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">
                      {o.suppliers?.name ?? "Sem fornecedor"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {statusLabel(o.status)}
                      {" · "}
                      Criado em {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span className="shrink-0 self-start rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {statusLabel(o.status)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Valor estimado
                    </p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                      {hasPricedLines ? formatBRL(totalValue) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Itens
                    </p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                      {itemCount}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2 sm:col-span-1">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Previsão
                    </p>
                    <p className="mt-0.5 text-base font-semibold text-foreground">
                      {prevLabel ?? "—"}
                    </p>
                  </div>
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-lg lg:max-w-xl">
          <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
                <ShoppingCart className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-1 pr-6">
                <SheetTitle className="text-xl font-semibold sm:text-2xl">
                  {editingOrderId
                    ? sheetMode === "summary"
                      ? "Resumo do pedido"
                      : "Editar pedido de compra"
                    : "Novo pedido de compra"}
                </SheetTitle>
              </div>
              {editingOrderId ? (
                <div className="flex shrink-0 gap-2">
                  {sheetMode === "summary" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSheetMode("edit")}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Editar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSheetMode("summary")}
                    >
                      Voltar
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void deleteOrder()}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Excluir
                  </Button>
                </div>
              ) : null}
            </div>
          </SheetHeader>
          {editingOrderId && sheetMode === "summary" ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
              <div className="space-y-4 p-6">
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Pedido
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Fornecedor:{" "}
                    {suppliers.find((s) => s.id === supplierId)?.name ?? "Sem fornecedor"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Previsão:{" "}
                    {expectedDate
                      ? new Date(expectedDate + "T12:00:00").toLocaleDateString("pt-BR")
                      : "—"}
                  </p>
                  {notes ? (
                    <p className="mt-2 text-sm text-foreground">{notes}</p>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Itens
                  </p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {lines.map((l, idx) => {
                      const p = products.find((x) => x.id === l.product_id);
                      return (
                        <li
                          key={`${l.product_id}-${idx}`}
                          className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                        >
                          <p className="font-medium">{p?.name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {Number(l.quantity || 0).toLocaleString("pt-BR")} {p?.unit ?? ""}
                            {l.unit_value ? ` · R$ ${Number(l.unit_value).toFixed(2)} un.` : ""}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
            <div className="space-y-4 p-6">
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
                    className="space-y-2 rounded-md border p-2"
                  >
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Produto</Label>
                      <ProductPicker
                        products={productsSortedForPicker}
                        value={l.product_id}
                        showOpenOrderHint={productHasOtherOpenOrder}
                        onChange={(id) => {
                          const next = [...lines];
                          const p = products.find((x) => x.id === id);
                          next[i] = {
                            ...next[i]!,
                            product_id: id,
                            unit_code: p?.unit ?? "",
                          };
                          setLines(next);
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-full space-y-1 sm:w-28">
                        <Label className="text-xs text-muted-foreground">Unidade</Label>
                        <Select
                          value={l.unit_code || "__u__"}
                          onValueChange={(v) => {
                            const next = [...lines];
                            next[i] = { ...next[i]!, unit_code: v === "__u__" ? "" : v };
                            setLines(next);
                          }}
                        >
                          <SelectTrigger className="w-full sm:w-28">
                            <SelectValue placeholder="Unid." />
                          </SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="__u__">—</SelectItem>
                            {allowedUnitsForProduct(l.product_id).map((u) => (
                              <SelectItem key={`${l.product_id}-${u}`} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-full space-y-1 sm:w-24">
                        <Label className="text-xs text-muted-foreground">Quantidade</Label>
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
                      </div>
                      <div className="w-full space-y-1 sm:w-32">
                        <Label className="text-xs text-muted-foreground">
                          Valor unitário
                        </Label>
                        <Input
                          className="w-full sm:w-32"
                          type="text"
                          inputMode="numeric"
                          placeholder="R$ 0,00"
                          value={l.unit_value}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = {
                              ...next[i]!,
                              unit_value: formatCurrencyInput(e.target.value),
                            };
                            setLines(next);
                          }}
                        />
                      </div>
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
                    { product_id: "", quantity: "1", unit_value: "", unit_code: "" },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Linha
              </Button>
            </div>
            </div>
          </div>
          )}
          <SheetFooter className="shrink-0 gap-2 border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSheetOpen(false);
                setEditingOrderId(null);
              }}
            >
              Cancelar
            </Button>
            {editingOrderId && sheetMode === "summary" ? null : (
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
                ) : editingOrderId ? (
                  "Salvar alterações"
                ) : (
                  "Salvar"
                )}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={duplicateDialog != null}
        onOpenChange={(open) => {
          if (!open) setDuplicateDialog(null);
        }}
      >
        <DialogContent
          className="z-[100] sm:max-w-md"
          overlayClassName="z-[100]"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>Produto já em pedido em andamento</DialogTitle>
            <DialogDescription>
              Já existe pedido em aberto (rascunho ou enviado) com estes itens.
              Você pode voltar para ajustar ou registrar este pedido mesmo assim.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {(duplicateDialog ?? []).map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDuplicateDialog(null)}>
              Voltar
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                void saveOrder({ skipDuplicateCheck: true });
              }}
            >
              Criar pedido assim mesmo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

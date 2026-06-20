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
import { Textarea } from "@/components/ui/textarea";
import {
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { flattenProductUnitConversionsDrafts } from "@/lib/productUnitConversionsJson";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type WasteRow = {
  id: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  products: { name: string; unit: string } | null;
};

export function EstoquePerdasPanel({ companyId }: { companyId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<WasteRow[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

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
    (pid: string): string[] => {
      const product = productById.get(pid);
      if (!product) return [];
      const base = product.unit;
      const allowed = new Set<string>([base]);
      const convs = conversionsByProduct.get(pid) ?? [];
      for (const c of convs) {
        if (
          c.primary_unit_code?.trim().toLowerCase() ===
          base.trim().toLowerCase()
        ) {
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
    (pid: string, quantity: number, fromUnit: string): number | null => {
      const product = productById.get(pid);
      if (!product) return null;
      const convs = (conversionsByProduct.get(pid) ?? []).map((r) => ({
        primary_unit_code: r.primary_unit_code,
        secondary_unit_code: r.secondary_unit_code,
        primary_qty: Number(r.primary_qty),
        secondary_qty: Number(r.secondary_qty),
      }));
      const raw = convertQuantityForProduct(
        quantity,
        fromUnit,
        product.unit,
        product.unit,
        convs,
      );
      return raw == null ? null : roundHubQuantityForStock(raw);
    },
    [conversionsByProduct, productById],
  );

  useEffect(() => {
    if (!productId) {
      setUnitCode("");
      return;
    }
    const product = productById.get(productId);
    if (!product) {
      setUnitCode("");
      return;
    }
    const allowed = allowedUnitsForProduct(productId);
    if (
      !allowed.some((u) => u.trim().toLowerCase() === unitCode.trim().toLowerCase())
    ) {
      setUnitCode(product.unit);
    }
  }, [allowedUnitsForProduct, productById, productId, unitCode]);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name"),
      supabase
        .from("product_waste")
        .select(
          "id, quantity, reason, created_at, products!inner(name, unit, company_id)",
        )
        .eq("products.company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);
    setLoading(false);
    const productsList = (p.data ?? []) as Product[];
    setProducts(productsList);
    setRows((w.data ?? []) as unknown as WasteRow[]);
    setProductConversions(
      flattenProductUnitConversionsDrafts(companyId, productsList),
    );
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const submit = async () => {
    if (!productId) {
      toast.error("Selecione o produto.");
      return;
    }
    const q = parseFloat(qty.replace(",", "."));
    if (Number.isNaN(q) || q <= 0) {
      toast.error("Informe uma quantidade válida.");
      return;
    }
    const product = productById.get(productId);
    if (!product) {
      toast.error("Produto inválido.");
      return;
    }
    const allowedUnits = allowedUnitsForProduct(productId).map((u) =>
      u.trim().toLowerCase(),
    );
    const selectedUnit = unitCode.trim();
    if (!selectedUnit || !allowedUnits.includes(selectedUnit.toLowerCase())) {
      toast.error("Selecione uma unidade válida para o produto.");
      return;
    }
    const baseQty = toBaseQty(productId, q, selectedUnit);
    if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
      toast.error("Não foi possível converter a unidade selecionada.");
      return;
    }
    setSaving(true);
    const { data: w, error: we } = await supabase
      .from("product_waste")
      .insert({
        company_id: companyId,
        product_id: productId,
        quantity: baseQty,
        reason: reason.trim() || null,
      })
      .select("id")
      .single();

    if (we || !w?.id) {
      console.error(we);
      toast.error("Não foi possível registrar a perda.");
      setSaving(false);
      return;
    }

    const wid = w.id as string;
    const { error: ae } = await supabase.rpc("adjust_product_stock", {
      p_product_id: productId,
      p_delta: -baseQty,
      p_type: "out",
      p_reference_type: "waste",
      p_reference_id: wid,
      p_unit_value: null,
    });

    if (ae) {
      console.error(ae);
      await supabase.from("product_waste").delete().eq("id", wid);
      toast.error("Estoque insuficiente ou erro ao baixar.");
      setSaving(false);
      return;
    }

    toast.success("Perda registrada e estoque atualizado.");
    setQty("");
    setReason("");
    setSaving(false);
    void load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trash2 className="h-4 w-4" />
          Controle de desperdícios
        </CardTitle>
        <CardDescription>
          Registre perdas e avarias para manter o estoque alinhado à realidade e
          identificar itens críticos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Produto</Label>
            <Select
              value={productId || "__"}
              onValueChange={(v) => {
                const pid = v === "__" ? "" : v;
                setProductId(pid);
                const product = productById.get(pid);
                setUnitCode(product?.unit ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__">—</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quantidade</Label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select
              value={unitCode || "__"}
              onValueChange={(v) => setUnitCode(v === "__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__">—</SelectItem>
                {allowedUnitsForProduct(productId).map((u) => (
                  <SelectItem key={`${productId}-${u}`} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Validade, quebra, preparo errado…"
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Registrar perda"
              )}
            </Button>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium">Histórico recente</h4>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 p-3">
                  <div>
                    <span className="font-medium">{r.products?.name ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {Number(r.quantity).toLocaleString("pt-BR")}{" "}
                      {r.products?.unit}
                    </span>
                    {r.reason && (
                      <p className="text-xs text-muted-foreground">{r.reason}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

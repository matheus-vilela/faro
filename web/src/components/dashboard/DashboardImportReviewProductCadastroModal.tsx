import { Button } from "@/components/ui/button";
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
import { SearchSelect } from "@/components/ui/search-select";
import { buildProductUnitSelectOptions, isSystemUnitCode } from "@/lib/companyUnits/productUnitOptions";
import {
  buildNextConversionsAfterHubChange,
  computeStockQuantityAfterHubChange,
} from "@/lib/companyUnits/stockHubUnitChange";
import type { UnitConversionCodeRow } from "@/lib/companyUnits/convert";
import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import { loadProductUnitConversions } from "@/lib/productUnitConversionsService";
import { toProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type AliasRow = { unit_code: string; unit_label: string };

export function DashboardImportReviewProductCadastroModal({
  companyId,
  productId,
  open,
  onOpenChange,
  onSaved,
}: {
  companyId: string;
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("un");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");

  const unitOptions = useMemo(() => buildProductUnitSelectOptions(unit, aliases), [unit, aliases]);

  const knownUnitCodes = useMemo(
    () => new Set(unitOptions.map((u) => u.value.trim().toLowerCase())),
    [unitOptions],
  );

  const load = useCallback(async () => {
    if (!productId || !companyId) return;
    setLoading(true);
    const [pRes, aRes] = await Promise.all([
      supabase.from("products").select("*").eq("id", productId).eq("company_id", companyId).maybeSingle(),
      supabase
        .from("company_custom_unit_aliases")
        .select("unit_code, unit_label")
        .eq("company_id", companyId)
        .order("unit_label", { ascending: true }),
    ]);
    setLoading(false);
    if (pRes.error) {
      toast.error(pRes.error.message ?? "Não foi possível carregar o produto.");
      setProduct(null);
      return;
    }
    const row = pRes.data as Product | null;
    if (!row) {
      toast.error("Produto não encontrado.");
      setProduct(null);
      return;
    }
    setProduct(row);
    setName(row.name ?? "");
    setUnit((row.unit || "un").trim().toLowerCase());
    setSku(row.sku?.trim() ?? "");
    setBarcode(row.barcode?.trim() ?? "");
    setAliases((aRes.data ?? []) as AliasRow[]);
    if (aRes.error) {
      console.error(aRes.error);
    }
  }, [companyId, productId]);

  useEffect(() => {
    if (!open || !productId) return;
    void load();
  }, [open, productId, load]);

  const handleSave = async () => {
    if (!product) return;
    const newName = sanitizeCatalogProductName(name);
    if (!newName) {
      toast.error("Informe o nome do produto.");
      return;
    }
    const newUnit = unit.trim().toLowerCase();
    if (!newUnit) {
      toast.error("Informe a unidade de estoque.");
      return;
    }
    const nameChanged =
      newName !== sanitizeCatalogProductName(product.name ?? "");
    const unitChanged = newUnit !== (product.unit || "un").trim().toLowerCase();
    const skuChanged = (sku.trim() || null) !== (product.sku?.trim() || null);
    const barcodeChanged = (barcode.trim() || null) !== (product.barcode?.trim() || null);
    if (!nameChanged && !unitChanged && !skuChanged && !barcodeChanged) {
      onOpenChange(false);
      return;
    }
    setSaving(true);

    const oldUnit = (product.unit || "un").trim().toLowerCase();
    let convRows: UnitConversionCodeRow[] = [];
    let nextConvsToInsert: UnitConversionCodeRow[] | null = null;
    if (unitChanged) {
      const { rows: convDrafts, error: convLoadErr } =
        await loadProductUnitConversions(companyId, product.id);
      if (convLoadErr) {
        setSaving(false);
        toast.error(convLoadErr ?? "Não foi possível carregar conversões do produto.");
        return;
      }
      convRows = convDrafts.map((r) => ({
        primary_qty: Number(r.primary_qty),
        primary_unit_code: String(r.primary_unit_code ?? "").trim(),
        secondary_qty: Number(r.secondary_qty),
        secondary_unit_code: String(r.secondary_unit_code ?? "").trim(),
      }));
      nextConvsToInsert = buildNextConversionsAfterHubChange(convRows, oldUnit, newUnit);
    }

    const updates: Record<string, unknown> = {};
    if (nameChanged) updates.name = newName;
    if (skuChanged) updates.sku = sku.trim() || null;
    if (barcodeChanged) updates.barcode = barcode.trim() || null;
    if (unitChanged && nextConvsToInsert) {
      updates.unit = newUnit;
      if (isSystemUnitCode(newUnit) || knownUnitCodes.has(newUnit)) {
        updates.import_unit_needs_review = false;
        updates.import_unit_raw = null;
      }

      const curQty = Number(product.current_quantity ?? 0);
      const minQty = Number(product.min_quantity ?? 0);
      const nextCur = computeStockQuantityAfterHubChange(
        curQty,
        oldUnit,
        newUnit,
        convRows,
        nextConvsToInsert,
      );
      const nextMin = computeStockQuantityAfterHubChange(
        minQty,
        oldUnit,
        newUnit,
        convRows,
        nextConvsToInsert,
      );
      if (nextCur == null || nextMin == null) {
        setSaving(false);
        toast.error(
          "Não foi possível converter o estoque entre estas unidades automaticamente. Ajuste na página de produtos ou escolha unidades compatíveis (ex.: kg → un com modelo 1 UN = 100 g).",
        );
        return;
      }
      updates.current_quantity = nextCur;
      updates.min_quantity = nextMin;
      updates.unit_conversions = toProductUnitConversionsJson(
        nextConvsToInsert ?? [],
      );
    }

    const { error } = await supabase.from("products").update(updates).eq("id", product.id);
    if (error) {
      setSaving(false);
      toast.error(error.message ?? "Não foi possível salvar.");
      return;
    }

    setSaving(false);
    toast.success("Cadastro atualizado.");
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] w-full max-w-[calc(100%-2rem)] overflow-y-auto overflow-x-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ajustar cadastro</DialogTitle>
          <DialogDescription>
            Nome, unidade e códigos. Ao mudar a unidade, o estoque é recalculado e aplicam-se conversões
            (ex.: 1 UN = 100 g ou 100 ml; pares kg/g e l/ml seguem o catálogo do sistema). Para CMV e mais
            opções, use a página de produtos.
          </DialogDescription>
        </DialogHeader>
        {loading || !product ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label htmlFor="dash-prod-name">Nome</Label>
              <Input
                id="dash-prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label>Unidade de estoque</Label>
              <SearchSelect
                value={unit}
                onValueChange={setUnit}
                options={unitOptions}
                placeholder="Unidade"
                searchPlaceholder="Buscar unidade…"
                emptyMessage="Nenhuma unidade encontrada."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dash-prod-sku">SKU (opcional)</Label>
              <Input
                id="dash-prod-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dash-prod-barcode">Código de barras (opcional)</Label>
              <Input
                id="dash-prod-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        )}
        <DialogFooter className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {productId ? (
            <Button
              type="button"
              variant="link"
              className="h-auto min-w-0 shrink px-0 text-left text-muted-foreground whitespace-normal"
              asChild
            >
              <Link to={`/app/produtos?highlight=${encodeURIComponent(productId)}`} target="_blank" rel="noreferrer">
                Abrir ficha completa em nova aba
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={loading || !product || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

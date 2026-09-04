import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SearchSelect } from "@/components/ui/search-select";
import {
  fetchSaleFamilyCandidates,
  fetchVariantPickerOptions,
  linkSaleFamilyVariant,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const EMPTY_SALE_NAMES: string[] = [];

export function SaleFamilyLinkSheet({
  open,
  onOpenChange,
  companyId,
  onLinked,
  saleNames = EMPTY_SALE_NAMES,
  familyProductId = null,
  variantProductId = null,
  variantName = null,
  variantSku = null,
  variantUnit = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onLinked: () => void;
  saleNames?: string[];
  familyProductId?: string | null;
  variantProductId?: string | null;
  variantName?: string | null;
  variantSku?: string | null;
  variantUnit?: string | null;
}) {
  const [families, setFamilies] = useState<SaleFamilyProductOption[]>([]);
  const [variants, setVariants] = useState<SaleFamilyProductOption[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [pickedVariantId, setPickedVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const stockLocked = Boolean(variantName?.trim());
  const variantLocked = Boolean(variantProductId);
  const familyLocked = Boolean(familyProductId);

  useEffect(() => {
    if (!open || !companyId) return;
    setFamilyId(familyProductId ?? "");
    setPickedVariantId(variantProductId ?? "");
    setQty("1");
    setLoading(true);
    void Promise.all([
      fetchSaleFamilyCandidates(companyId, saleNames),
      variantLocked || stockLocked
        ? Promise.resolve([] as SaleFamilyProductOption[])
        : fetchVariantPickerOptions(companyId, familyProductId),
    ])
      .then(([fam, vars]) => {
        setFamilies(fam.filter((p) => p.id !== variantProductId));
        setVariants(vars);
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Falha ao listar produtos.");
        setFamilies([]);
        setVariants([]);
      })
      .finally(() => setLoading(false));
  }, [
    open,
    companyId,
    saleNames,
    familyProductId,
    variantProductId,
    variantLocked,
    stockLocked,
  ]);

  const save = async () => {
    const family = familyLocked ? familyProductId : familyId;
    if (!family) {
      toast.error("Escolha o item de cardápio (agrupamento).");
      return;
    }
    const qtyPerSale = Number(qty.replace(",", "."));
    if (!Number.isFinite(qtyPerSale) || qtyPerSale <= 0) {
      toast.error("Informe a proporção (ex.: 3).");
      return;
    }

    const existingVariant = variantLocked
      ? variantProductId
      : pickedVariantId || null;
    const nameFromPick = variants.find((v) => v.id === existingVariant)?.name;
    const name = (variantName ?? nameFromPick ?? "").trim();
    if (!existingVariant && !name) {
      toast.error("Escolha a variante de estoque.");
      return;
    }

    setSaving(true);
    try {
      const result = await linkSaleFamilyVariant({
        companyId,
        familyProductId: family,
        variantName: name || "Variante",
        variantSku: variantSku,
        variantUnit: variantUnit ?? "un",
        qtyPerSale,
        variantProductId: existingVariant,
      });
      toast.success(
        result.promoted_family
          ? "Produto virou agrupamento e a variante foi vinculada."
          : "Variante vinculada ao agrupamento.",
      );
      onLinked();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Vincular variante</SheetTitle>
          <SheetDescription>
            Liga um item de estoque a um item de cardápio. A venda do
            agrupamento não baixa estoque; só a variante sai no relatório do
            dia.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {stockLocked ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium">{variantName}</p>
              <p className="text-muted-foreground font-mono text-xs">
                SKU {variantSku || "—"}
              </p>
            </div>
          ) : null}

          {!familyLocked ? (
            <div className="space-y-1.5">
              <Label>Agrupamento (cardápio)</Label>
              <SearchSelect
                value={familyId}
                onValueChange={setFamilyId}
                placeholder={
                  loading ? "Carregando…" : "Ex.: Bolinhos da venda do dia"
                }
                searchPlaceholder="Buscar produto…"
                disabled={loading || saving}
                contentClassName="z-[200]"
                options={families.map((p) => ({
                  value: p.id,
                  label: p.name,
                  description:
                    p.stock_control_type === "SALE_FAMILY"
                      ? "Já é agrupamento"
                      : p.sku
                        ? `SKU ${p.sku} · vira agrupamento ao vincular`
                        : "Vira agrupamento ao vincular",
                  keywords: p.sku ?? "",
                }))}
              />
            </div>
          ) : null}

          {!stockLocked && !variantLocked ? (
            <div className="space-y-1.5">
              <Label>Variante de estoque</Label>
              <SearchSelect
                value={pickedVariantId}
                onValueChange={setPickedVariantId}
                placeholder={
                  loading ? "Carregando…" : "Produto que sai no estoque"
                }
                searchPlaceholder="Buscar variante…"
                disabled={loading || saving}
                contentClassName="z-[200]"
                options={variants.map((p) => ({
                  value: p.id,
                  label: p.name,
                  description: p.sku ? `SKU ${p.sku}` : undefined,
                  keywords: p.sku ?? "",
                }))}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="sale-family-qty">
              Quantidade da variante por 1 venda do agrupamento
            </Label>
            <Input
              id="sale-family-qty"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={saving}
            />
            <p className="text-muted-foreground text-xs">
              Só cadastro (ex.: 3 bolinhos de carne em 1 Bolinhos). Não gera
              movimento.
            </p>
          </div>
        </div>
        <SheetFooter>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Vincular variante"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

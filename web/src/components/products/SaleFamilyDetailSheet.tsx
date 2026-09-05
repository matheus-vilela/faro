import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  fetchVariantPickerOptions,
  linkSaleFamilyVariant,
  listSaleFamilyForProduct,
  unlinkSaleFamilyVariant,
  type SaleFamilyListRow,
  type SaleFamilyMember,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import { Loader2, Plus, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type SortKey = "name" | "sku" | "qty";

export function SaleFamilyDetailSheet({
  open,
  onOpenChange,
  companyId,
  family,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  family: SaleFamilyListRow | null;
  onChanged: () => void;
}) {
  const listView = useSheetListView();
  const [members, setMembers] = useState<SaleFamilyMember[]>([]);
  const [variants, setVariants] = useState<SaleFamilyProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedVariantId, setPickedVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const familyId = family?.id ?? null;

  const reload = useCallback(async () => {
    if (!companyId || !familyId) return;
    setLoading(true);
    try {
      const [info, opts] = await Promise.all([
        listSaleFamilyForProduct(companyId, familyId),
        fetchVariantPickerOptions(companyId, familyId),
      ]);
      setMembers(info.members);
      setVariants(opts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o agrupamento.");
      setMembers([]);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, familyId]);

  useEffect(() => {
    if (open && family) setMembers(family.members);
  }, [open, family]);

  useEffect(() => {
    if (!open || !familyId) return;
    setPickedVariantId("");
    setQty("1");
    void reload();
  }, [open, familyId, reload]);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    SaleFamilyMember,
    SortKey
  >(
    members,
    "name",
    (a, b, key) => {
      if (key === "sku") {
        return (a.sku ?? "").localeCompare(b.sku ?? "", "pt-BR", {
          numeric: true,
        });
      }
      if (key === "qty") return a.qty_per_sale - b.qty_per_sale;
      return a.name.localeCompare(b.name, "pt-BR");
    },
    true,
  );

  const addVariant = async () => {
    if (!familyId) return;
    const picked = variants.find((v) => v.id === pickedVariantId);
    if (!picked) {
      toast.error("Escolha a variante de estoque.");
      return;
    }
    const qtyPerSale = Number(qty.replace(",", "."));
    if (!Number.isFinite(qtyPerSale) || qtyPerSale <= 0) {
      toast.error("Informe a proporção (ex.: 3).");
      return;
    }
    setSaving(true);
    try {
      await linkSaleFamilyVariant({
        companyId,
        familyProductId: familyId,
        variantName: picked.name,
        variantSku: picked.sku,
        qtyPerSale,
        variantProductId: picked.id,
      });
      toast.success("Variante vinculada ao agrupamento.");
      setPickedVariantId("");
      setQty("1");
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular.");
    } finally {
      setSaving(false);
    }
  };

  const unlink = async (variantId: string) => {
    setBusyId(variantId);
    try {
      await unlinkSaleFamilyVariant(companyId, variantId);
      toast.success("Variante desvinculada.");
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desvincular.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>{family?.name ?? "Agrupamento"}</SheetTitle>
          <SheetDescription>
            {family?.sku ? `SKU ${family.sku}. ` : ""}
            A venda não baixa este item. As variantes saem pelo estoque do dia.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {loading && members.length === 0 ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma variante ainda. Adicione um produto abaixo.
            </p>
          ) : listView === "cards" ? (
            <ul className="space-y-2">
              {sorted.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {m.sku || "sem SKU"} · {m.qty_per_sale} por 1
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyId != null}
                    onClick={() => void unlink(m.variant_product_id)}
                  >
                    {busyId === m.variant_product_id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Unlink className="size-3.5" />
                    )}
                    Desvincular
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <SortableTableHead
                      label="Variante"
                      column="name"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="SKU"
                      column="sku"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="Qtd por 1"
                      column="qty"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <th className="w-28 px-3 py-2 text-right font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2.5 font-medium">{m.name}</td>
                      <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs">
                        {m.sku || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {m.qty_per_sale}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId != null}
                          onClick={() => void unlink(m.variant_product_id)}
                        >
                          {busyId === m.variant_product_id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Unlink className="size-3.5" />
                          )}
                          Desvincular
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <SheetFooter className="gap-3 border-t">
          <div className="w-full space-y-3">
            <p className="text-sm font-medium">Adicionar variante</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label>Produto de estoque</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="agrupamento-qty">Qtd por 1</Label>
                <Input
                  id="agrupamento-qty"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={saving}
                />
              </div>
              <Button
                type="button"
                onClick={() => void addVariant()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Adicionar
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Só cadastro (ex.: 3 bolinhos de carne em 1 Bolinhos). Não gera
              movimento. O produto continua no catálogo.
            </p>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

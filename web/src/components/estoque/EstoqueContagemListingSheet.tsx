import { Button } from "@/components/ui/button";
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
import { formatScheduleWhen } from "@/lib/inventoryCount/scheduleNextRun";
import { COUNT_SELECT_TRIGGER_CLASS } from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
  InventoryCountSchedule,
} from "@/types/inventoryCount";
import type { Product } from "@/types/product";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function productMatches(p: Product, q: string): boolean {
  if (!q) return true;
  const name = p.name.toLowerCase();
  const sku = p.sku?.toLowerCase() ?? "";
  const ean = p.ean?.toLowerCase() ?? "";
  return name.includes(q) || sku.includes(q) || ean.includes(q);
}

export function EstoqueContagemListingSheet({
  open,
  onOpenChange,
  mode,
  companyId,
  groups,
  members,
  products,
  listing,
  listingProductIds,
  defaultGroupId,
  nextSchedule,
  nextSortOrder = 0,
  onChanged,
  onProgramar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  companyId: string;
  groups: InventoryCountGroup[];
  members: CompanyMember[];
  products: Product[];
  listing: InventoryCountListing | null;
  listingProductIds: string[];
  defaultGroupId: string;
  nextSchedule: InventoryCountSchedule | null;
  nextSortOrder?: number;
  onChanged: () => void;
  onProgramar: () => void;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [inListIds, setInListIds] = useState<Set<string>>(new Set());
  const [addSearch, setAddSearch] = useState("");
  const [inListSearch, setInListSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingOperator, setSavingOperator] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && listing) {
      setName(listing.name);
      setGroupId(listing.inventory_count_group_id);
      setMemberId(listing.assigned_company_member_id ?? "");
      setInListIds(new Set(listingProductIds));
    } else {
      setName("");
      setGroupId(defaultGroupId);
      setMemberId("");
      setInListIds(new Set());
    }
    setAddSearch("");
    setInListSearch("");
  }, [open, mode, listing, listingProductIds, defaultGroupId]);

  const inListProducts = useMemo(() => {
    const q = inListSearch.trim().toLowerCase();
    return products.filter((p) => inListIds.has(p.id) && productMatches(p, q));
  }, [inListIds, inListSearch, products]);

  const catalogProducts = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return products.filter((p) => !inListIds.has(p.id) && productMatches(p, q));
  }, [addSearch, inListIds, products]);

  const persistProducts = async (next: Set<string>) => {
    if (mode !== "edit" || !listing) return;
    const { error: delError } = await supabase
      .from("inventory_count_listing_products")
      .delete()
      .eq("listing_id", listing.id);
    if (delError) {
      toast.error("Não foi possível atualizar os produtos.");
      return;
    }
    const ids = [...next];
    if (ids.length === 0) return;
    const { error: insError } = await supabase
      .from("inventory_count_listing_products")
      .insert(
        ids.map((productId) => ({
          company_id: companyId,
          listing_id: listing.id,
          product_id: productId,
        })),
      );
    if (insError) {
      toast.error("Não foi possível salvar os produtos.");
      return;
    }
    onChanged();
  };

  const addProduct = (productId: string) => {
    setInListIds((prev) => {
      const next = new Set(prev);
      next.add(productId);
      void persistProducts(next);
      return next;
    });
  };

  const removeProduct = (productId: string) => {
    setInListIds((prev) => {
      const next = new Set(prev);
      next.delete(productId);
      void persistProducts(next);
      return next;
    });
  };

  const saveOperator = async (nextId: string) => {
    setMemberId(nextId);
    if (mode !== "edit" || !listing) return;
    setSavingOperator(true);
    const { error } = await supabase
      .from("inventory_count_listings")
      .update({ assigned_company_member_id: nextId || null })
      .eq("id", listing.id);
    setSavingOperator(false);
    if (error) {
      toast.error("Não foi possível trocar o operador.");
      return;
    }
    toast.success("Operador atualizado.");
    onChanged();
  };

  const saveHeader = async (overrides?: { name?: string; groupId?: string }) => {
    if (mode !== "edit" || !listing) return;
    const trimmed = (overrides?.name ?? name).trim();
    const nextGroup = overrides?.groupId ?? groupId;
    if (!trimmed) {
      toast.error("Informe o nome da listagem.");
      return;
    }
    if (!nextGroup) {
      toast.error("Selecione o grupo.");
      return;
    }
    const { error } = await supabase
      .from("inventory_count_listings")
      .update({
        name: trimmed,
        inventory_count_group_id: nextGroup,
      })
      .eq("id", listing.id);
    if (error) {
      toast.error("Não foi possível salvar o cabeçalho.");
      return;
    }
    onChanged();
  };

  const createListing = async () => {
    const trimmed = name.trim();
    if (!groupId) {
      toast.error("Selecione o grupo.");
      return;
    }
    if (!trimmed) {
      toast.error("Informe o nome da listagem.");
      return;
    }
    const productIds = [...inListIds];
    if (productIds.length === 0) {
      toast.error("Adicione ao menos um produto.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("inventory_count_listings")
      .insert({
        company_id: companyId,
        inventory_count_group_id: groupId,
        name: trimmed,
        sort_order: nextSortOrder,
        assigned_company_member_id: memberId || null,
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      setSaving(false);
      toast.error("Não foi possível criar a listagem.");
      return;
    }
    const { error: itemsError } = await supabase
      .from("inventory_count_listing_products")
      .insert(
        productIds.map((productId) => ({
          company_id: companyId,
          listing_id: data.id,
          product_id: productId,
        })),
      );
    setSaving(false);
    if (itemsError) {
      await supabase.from("inventory_count_listings").delete().eq("id", data.id);
      toast.error("Não foi possível vincular produtos à listagem.");
      return;
    }
    toast.success("Listagem criada.");
    onOpenChange(false);
    onChanged();
  };

  const deleteListing = async () => {
    if (!listing) return;
    const ok = window.confirm(
      `Remover a listagem "${listing.name}"? Esta ação não pode ser desfeita.`,
    );
    if (!ok) return;
    setDeleting(true);
    const { error } = await supabase
      .from("inventory_count_listings")
      .delete()
      .eq("id", listing.id);
    setDeleting(false);
    if (error) {
      toast.error("Não foi possível remover a listagem.");
      return;
    }
    toast.success("Listagem removida.");
    onOpenChange(false);
    onChanged();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full flex-col gap-0 p-0">
        <SheetHeader className="border-b px-6 py-4 pr-16">
          <SheetTitle>
            {mode === "create" ? "Nova listagem" : "Editar listagem"}
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                className={COUNT_SELECT_TRIGGER_CLASS}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (mode === "edit") void saveHeader();
                }}
                maxLength={120}
                placeholder="Ex.: Cozinha fria"
              />
            </div>
            <div className="space-y-2">
              <Label>Grupo</Label>
              <Select
                value={groupId || "__none__"}
                onValueChange={(v) => {
                  const next = v === "__none__" ? "" : v;
                  setGroupId(next);
                  if (mode === "edit") {
                    void saveHeader({ groupId: next });
                  }
                }}
              >
                <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="Grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Selecione</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Operador</Label>
              <Select
                value={memberId || "__none__"}
                onValueChange={(v) =>
                  void saveOperator(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger
                  className={cn(
                    COUNT_SELECT_TRIGGER_CLASS,
                    "border-primary/50 bg-primary/10",
                    savingOperator && "opacity-70",
                  )}
                >
                  <SelectValue placeholder="Qualquer pessoa com o link" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    Qualquer pessoa com o link
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                A troca de operador vale na hora, sem salvar o resto da ficha.
              </p>
            </div>
            {mode === "edit" ? (
              <div className="flex flex-wrap items-end justify-between gap-2 sm:col-span-2">
                <p className="text-sm text-muted-foreground">
                  Próxima agenda:{" "}
                  <span className="font-medium text-foreground">
                    {formatScheduleWhen(nextSchedule?.next_run_at)}
                  </span>
                </p>
                <Button type="button" variant="outline" size="sm" onClick={onProgramar}>
                  Programar
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid min-h-[22rem] gap-4 md:grid-cols-2">
            <section className="flex min-h-0 flex-col rounded-xl border">
              <div className="border-b px-3 py-2">
                <p className="text-sm font-semibold">Nesta lista</p>
                <p className="text-xs text-muted-foreground">
                  {inListIds.size} produto(s)
                </p>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-sm"
                    value={inListSearch}
                    onChange={(e) => setInListSearch(e.target.value)}
                    placeholder="Filtrar nesta lista…"
                  />
                </div>
              </div>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {inListProducts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">{p.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => removeProduct(p.id)}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
                {inListProducts.length === 0 ? (
                  <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                    Nenhum produto nesta lista.
                  </li>
                ) : null}
              </ul>
            </section>

            <section className="flex min-h-0 flex-col rounded-xl border">
              <div className="border-b px-3 py-2">
                <p className="text-sm font-semibold">Adicionar produtos</p>
                <p className="text-xs text-muted-foreground">
                  Catálogo ativo — a busca só filtra
                </p>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-sm"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="Filtrar por nome, SKU ou EAN…"
                  />
                </div>
              </div>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {catalogProducts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.unit}
                        {p.sku ? ` · ${p.sku}` : ""}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => addProduct(p.id)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
                {catalogProducts.length === 0 ? (
                  <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {products.length === 0
                      ? "Nenhum produto ativo."
                      : "Todos os produtos já estão na lista (ou não batem com o filtro)."}
                  </li>
                ) : null}
              </ul>
            </section>
          </div>
        </div>
        <SheetFooter className="flex-row items-center justify-end gap-2 border-t px-6 py-3">
          {mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting}
              onClick={() => void deleteListing()}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Remover
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          )}
          {mode === "create" ? (
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={saving}
              onClick={() => void createListing()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Criar listagem
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

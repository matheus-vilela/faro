import { EstoqueHistoricoContagem } from "@/components/estoque/EstoqueHistoricoContagem";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { randomShortSlug } from "@/lib/randomSlug";
import { supabase } from "@/lib/supabase";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
} from "@/types/inventoryCount";
import type { Product } from "@/types/product";
import {
  ClipboardList,
  Copy,
  FolderPlus,
  Layers,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type GeneratedLink = { label: string; url: string };

export function EstoqueContagemPanel({ companyId }: { companyId: string }) {
  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const [groups, setGroups] = useState<InventoryCountGroup[]>([]);
  const [listings, setListings] = useState<InventoryCountListing[]>([]);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [listingProductRows, setListingProductRows] = useState<
    { listing_id: string; product_id: string }[]
  >([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const [listingDialogOpen, setListingDialogOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [newListingName, setNewListingName] = useState("");
  const [newListingAssignedMemberId, setNewListingAssignedMemberId] =
    useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [savingListing, setSavingListing] = useState(false);
  const [deletingListingId, setDeletingListingId] = useState<string>("");
  const [listingSheetOpen, setListingSheetOpen] = useState(false);
  const [activeListingId, setActiveListingId] = useState<string>("");
  const [listingSheetMode, setListingSheetMode] = useState<"summary" | "edit">(
    "summary",
  );
  const [editListingName, setEditListingName] = useState("");
  const [editListingGroupId, setEditListingGroupId] = useState("");
  const [editListingAssignedMemberId, setEditListingAssignedMemberId] =
    useState("");
  const [editListingProductSearch, setEditListingProductSearch] = useState("");
  const [editListingProductIds, setEditListingProductIds] = useState<
    Set<string>
  >(new Set());
  const [savingListingEdit, setSavingListingEdit] = useState(false);

  const [linkTarget, setLinkTarget] = useState<"group" | "listing">("group");
  const [targetGroupId, setTargetGroupId] = useState<string>("");
  const [targetListingId, setTargetListingId] = useState<string>("");

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    const [gr, li, mem, prod, lprod] = await Promise.all([
      supabase
        .from("inventory_count_groups")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("inventory_count_listings")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("company_members")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name", { ascending: true }),
      supabase
        .from("inventory_count_listing_products")
        .select("listing_id, product_id"),
    ]);
    if (gr.error) console.error(gr.error);
    if (li.error) console.error(li.error);
    if (mem.error) console.error(mem.error);
    if (prod.error) console.error(prod.error);
    if (lprod.error) console.error(lprod.error);
    setGroups((gr.data ?? []) as InventoryCountGroup[]);
    setListings((li.data ?? []) as InventoryCountListing[]);
    setMembers((mem.data ?? []) as CompanyMember[]);
    setProducts((prod.data ?? []) as Product[]);
    setListingProductRows(
      (lprod.data ?? []) as { listing_id: string; product_id: string }[],
    );
    setLoadingMeta(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void loadMeta());
  }, [loadMeta]);

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0]!.id);
    }
    if (!targetGroupId && groups.length > 0) {
      setTargetGroupId(groups[0]!.id);
    }
  }, [groups, selectedGroupId, targetGroupId]);

  useEffect(() => {
    if (linkTarget === "listing" && !targetListingId) {
      const list = listings.find(
        (l) => l.inventory_count_group_id === targetGroupId,
      );
      if (list?.id) setTargetListingId(list.id);
    }
  }, [linkTarget, listings, targetGroupId, targetListingId]);

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error("Informe o nome do grupo.");
      return;
    }
    setSavingGroup(true);
    const { data, error } = await supabase
      .from("inventory_count_groups")
      .insert({
        company_id: companyId,
        name,
        sort_order: groups.length,
      })
      .select("id")
      .single();
    setSavingGroup(false);
    if (error) {
      console.error(error);
      toast.error(error.message ?? "Não foi possível criar o grupo.");
      return;
    }
    toast.success("Grupo criado.");
    setNewGroupName("");
    setGroupDialogOpen(false);
    const gid = data?.id as string | undefined;
    if (gid) {
      await supabase.from("inventory_count_listings").insert({
        company_id: companyId,
        inventory_count_group_id: gid,
        name: "Lista principal",
        sort_order: 0,
      });
      setSelectedGroupId(gid);
      setTargetGroupId(gid);
    }
    await loadMeta();
  };

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = p.name.toLowerCase();
      const sku = p.sku?.toLowerCase() ?? "";
      return name.includes(q) || sku.includes(q);
    });
  }, [productSearch, products]);

  const productCountByListing = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of listingProductRows) {
      out.set(row.listing_id, (out.get(row.listing_id) ?? 0) + 1);
    }
    return out;
  }, [listingProductRows]);

  const canDeleteGroup = useCallback(
    (groupId: string) => {
      const groupListings = listings.filter(
        (l) => l.inventory_count_group_id === groupId,
      );
      if (groupListings.length === 0) return true;
      if (groupListings.length === 1) {
        return (
          groupListings[0]!.name.trim().toLowerCase() === "lista principal"
        );
      }
      return false;
    },
    [listings],
  );

  const createListing = async () => {
    const name = newListingName.trim();
    if (!selectedGroupId) {
      toast.error("Selecione um grupo para a listagem.");
      return;
    }
    if (!name) {
      toast.error("Informe o nome da listagem.");
      return;
    }
    const productIds = [...selectedProductIds];
    if (productIds.length === 0) {
      toast.error("Selecione ao menos um produto para a listagem.");
      return;
    }
    setSavingListing(true);
    const currentCount = listings.filter(
      (l) => l.inventory_count_group_id === selectedGroupId,
    ).length;
    const { data, error } = await supabase
      .from("inventory_count_listings")
      .insert({
        company_id: companyId,
        inventory_count_group_id: selectedGroupId,
        name,
        sort_order: currentCount,
        assigned_company_member_id: newListingAssignedMemberId || null,
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      console.error(error);
      toast.error("Não foi possível criar a listagem.");
      setSavingListing(false);
      return;
    }
    const listingId = data.id as string;
    const { error: itemsError } = await supabase
      .from("inventory_count_listing_products")
      .insert(
        productIds.map((productId) => ({
          company_id: companyId,
          listing_id: listingId,
          product_id: productId,
        })),
      );
    setSavingListing(false);
    if (itemsError) {
      console.error(itemsError);
      await supabase
        .from("inventory_count_listings")
        .delete()
        .eq("id", listingId);
      toast.error("Não foi possível vincular produtos à listagem.");
      return;
    }
    toast.success("Listagem criada.");
    setListingDialogOpen(false);
    setNewListingName("");
    setNewListingAssignedMemberId("");
    setSelectedProductIds(new Set());
    setProductSearch("");
    await loadMeta();
    setTargetListingId(listingId);
  };

  const deleteListing = async (listingId: string) => {
    const listing = listings.find((l) => l.id === listingId);
    if (!listing) return;
    const ok = window.confirm(
      `Remover a listagem "${listing.name}"? Esta ação não pode ser desfeita.`,
    );
    if (!ok) return;
    setDeletingListingId(listingId);
    const { error } = await supabase
      .from("inventory_count_listings")
      .delete()
      .eq("id", listingId);
    setDeletingListingId("");
    if (error) {
      console.error(error);
      toast.error("Não foi possível remover a listagem.");
      return;
    }
    if (targetListingId === listingId) {
      setTargetListingId("");
    }
    if (activeListingId === listingId) {
      setListingSheetOpen(false);
      setActiveListingId("");
    }
    toast.success("Listagem removida.");
    await loadMeta();
  };

  const deleteSelectedGroup = async (groupIdArg?: string) => {
    const groupIdToDelete = groupIdArg ?? selectedGroupId;
    if (!groupIdToDelete) {
      toast.error("Selecione um grupo.");
      return;
    }
    const group = groups.find((g) => g.id === groupIdToDelete);
    if (!group) return;
    if (!canDeleteGroup(groupIdToDelete)) {
      toast.error(
        'Só é possível remover grupo sem listagens ou com apenas a "Lista principal".',
      );
      return;
    }
    const ok = window.confirm(
      `Remover o grupo "${group.name}"? Esta ação não pode ser desfeita.`,
    );
    if (!ok) return;
    setDeletingGroup(true);
    const { error } = await supabase
      .from("inventory_count_groups")
      .delete()
      .eq("id", groupIdToDelete);
    setDeletingGroup(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível remover o grupo.");
      return;
    }
    toast.success("Grupo removido.");
    if (selectedGroupId === groupIdToDelete) {
      setSelectedGroupId("");
    }
    if (targetGroupId === groupIdToDelete) {
      setTargetGroupId("");
      setTargetListingId("");
    }
    await loadMeta();
  };

  const openListingSheet = (listingId: string) => {
    const listing = listings.find((l) => l.id === listingId);
    if (!listing) return;
    const ids = listingProductRows
      .filter((r) => r.listing_id === listingId)
      .map((r) => r.product_id);
    setActiveListingId(listingId);
    setListingSheetMode("summary");
    setEditListingName(listing.name);
    setEditListingGroupId(listing.inventory_count_group_id);
    setEditListingAssignedMemberId(listing.assigned_company_member_id ?? "");
    setEditListingProductIds(new Set(ids));
    setEditListingProductSearch("");
    setListingSheetOpen(true);
  };

  const activeListing = useMemo(
    () => listings.find((l) => l.id === activeListingId) ?? null,
    [activeListingId, listings],
  );

  const filteredEditListingProducts = useMemo(() => {
    const q = editListingProductSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = p.name.toLowerCase();
      const sku = p.sku?.toLowerCase() ?? "";
      return name.includes(q) || sku.includes(q);
    });
  }, [editListingProductSearch, products]);

  const saveListingEdit = async () => {
    if (!activeListingId) return;
    const name = editListingName.trim();
    if (!name) {
      toast.error("Informe o nome da listagem.");
      return;
    }
    if (!editListingGroupId) {
      toast.error("Selecione o grupo da listagem.");
      return;
    }
    const productIds = [...editListingProductIds];
    if (productIds.length === 0) {
      toast.error("Selecione ao menos um produto.");
      return;
    }
    setSavingListingEdit(true);
    const { error: upError } = await supabase
      .from("inventory_count_listings")
      .update({
        name,
        inventory_count_group_id: editListingGroupId,
        assigned_company_member_id: editListingAssignedMemberId || null,
      })
      .eq("id", activeListingId);
    if (upError) {
      console.error(upError);
      toast.error("Não foi possível atualizar a listagem.");
      setSavingListingEdit(false);
      return;
    }
    const { error: delError } = await supabase
      .from("inventory_count_listing_products")
      .delete()
      .eq("listing_id", activeListingId);
    if (delError) {
      console.error(delError);
      toast.error("Não foi possível atualizar os produtos da listagem.");
      setSavingListingEdit(false);
      return;
    }
    const { error: insError } = await supabase
      .from("inventory_count_listing_products")
      .insert(
        productIds.map((productId) => ({
          company_id: companyId,
          listing_id: activeListingId,
          product_id: productId,
        })),
      );
    setSavingListingEdit(false);
    if (insError) {
      console.error(insError);
      toast.error("Não foi possível salvar os produtos da listagem.");
      return;
    }
    toast.success("Listagem atualizada.");
    setListingSheetMode("summary");
    await loadMeta();
  };

  const createOneLink = useCallback(
    async (params: {
      inventory_count_group_id: string | null;
      inventory_count_listing_id: string | null;
      assigned_company_member_id: string | null;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;

      const { data: sess, error: se } = await supabase
        .from("inventory_count_sessions")
        .insert({
          company_id: companyId,
          status: "open",
          created_by_user_id: uid,
          inventory_count_group_id: params.inventory_count_group_id,
          inventory_count_listing_id: params.inventory_count_listing_id,
          assigned_company_member_id: params.assigned_company_member_id,
        })
        .select("id, token")
        .single();

      if (se || !sess?.id || !sess?.token) {
        throw new Error(se?.message ?? "Falha ao criar sessão.");
      }

      let slug: string | null = null;
      for (let i = 0; i < 15; i++) {
        const s = randomShortSlug(8);
        const { error: le } = await supabase
          .from("inventory_count_short_links")
          .insert({
            company_id: companyId,
            slug: s,
            session_id: sess.id,
            token: sess.token,
          });
        if (!le) {
          slug = s;
          break;
        }
        const code = (le as { code?: string }).code;
        if (code !== "23505") {
          throw new Error(le.message);
        }
      }

      const base = window.location.origin.replace(/\/$/, "");
      const url = slug
        ? `${base}/i/${slug}`
        : `${base}/contagem-estoque/${sess.token}`;

      return url;
    },
    [companyId],
  );

  const createLinks = useCallback(async () => {
    setLoading(true);
    try {
      const generated: GeneratedLink[] = [];
      if (linkTarget === "listing") {
        const listing = listings.find((l) => l.id === targetListingId);
        if (!listing) {
          toast.error("Selecione uma listagem válida.");
          setLoading(false);
          return;
        }
        const url = await createOneLink({
          inventory_count_group_id: listing.inventory_count_group_id,
          inventory_count_listing_id: listing.id,
          assigned_company_member_id: listing.assigned_company_member_id,
        });
        generated.push({ label: listing.name, url });
      } else {
        if (!targetGroupId) {
          toast.error("Selecione um grupo.");
          setLoading(false);
          return;
        }
        const groupListings = listings.filter(
          (l) => l.inventory_count_group_id === targetGroupId,
        );
        if (groupListings.length === 0) {
          toast.error("Este grupo não possui listagens.");
          setLoading(false);
          return;
        }
        for (const listing of groupListings) {
          const url = await createOneLink({
            inventory_count_group_id: listing.inventory_count_group_id,
            inventory_count_listing_id: listing.id,
            assigned_company_member_id: listing.assigned_company_member_id,
          });
          generated.push({ label: listing.name, url });
        }
      }
      setLinks(generated);
      setHistoryTick((t) => t + 1);
      toast.success(
        generated.length === 1
          ? "Link da listagem gerado."
          : "Links do grupo gerados (um por listagem).",
      );
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível gerar os links de contagem.");
    } finally {
      setLoading(false);
    }
  }, [createOneLink, linkTarget, listings, targetGroupId, targetListingId]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Link copiado.");
  };

  const copyWhatsappMessage = () => {
    if (links.length === 0) return;
    const lines = ["*Contagem de estoque*", ""];
    for (const row of links) {
      lines.push(`*${row.label}*`);
      lines.push(row.url);
      lines.push("");
    }
    lines.push(
      links.length > 1
        ? "Mensagem para o grupo: cada operador deve abrir sua listagem."
        : "Mensagem para operador: abrir e enviar a listagem.",
    );
    void navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Mensagem de WhatsApp copiada.");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderPlus className="h-4 w-4" />
                Grupos de contagem
              </CardTitle>
              <CardDescription>
                Cadastre rótulos para organizar contagens por setor, depósito ou
                campanha. Cada grupo pode ter uma ou mais listagens de contagem,
                com operador e produtos próprios.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingMeta ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background p-3">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">Grupo</Label>
                <span className="text-[11px] text-muted-foreground">
                  {groups.length} cadastrados
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <Select
                    value={selectedGroupId || "__none__"}
                    onValueChange={(v) =>
                      setSelectedGroupId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger className="border-primary/30 bg-background">
                      <SelectValue placeholder="Selecione o grupo" />
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
                <Button
                  type="button"
                  size="sm"
                  className="sm:min-w-28"
                  onClick={() => setGroupDialogOpen(true)}
                >
                  Novo grupo
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  disabled={
                    !selectedGroupId ||
                    deletingGroup ||
                    !canDeleteGroup(selectedGroupId)
                  }
                  onClick={() => void deleteSelectedGroup(selectedGroupId)}
                  title={
                    !selectedGroupId || canDeleteGroup(selectedGroupId)
                      ? "Remover grupo"
                      : 'Só remove grupos sem listagens ou com apenas "Lista principal"'
                  }
                >
                  {deletingGroup ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Remoção permitida apenas para grupo vazio ou com somente a
                listagem padrão.
              </p>

              {selectedGroupId ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Listagens</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setListingDialogOpen(true)}
                    >
                      Nova listagem
                    </Button>
                  </div>
                  <ul className="space-y-2 rounded-md border p-2 text-sm">
                    {listings
                      .filter(
                        (l) => l.inventory_count_group_id === selectedGroupId,
                      )
                      .map((l) => (
                        <li key={l.id} className="rounded border p-2">
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => openListingSheet(l.id)}
                          >
                            <p className="font-medium text-foreground">
                              {l.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Operador:{" "}
                              {members.find(
                                (m) => m.id === l.assigned_company_member_id,
                              )?.name ?? "Qualquer"}
                              {" · "}
                              Produtos: {productCountByListing.get(l.id) ?? 0}
                            </p>
                          </button>
                        </li>
                      ))}
                    {listings.filter(
                      (l) => l.inventory_count_group_id === selectedGroupId,
                    ).length === 0 ? (
                      <li className="text-xs text-muted-foreground">
                        Nenhuma listagem neste grupo.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Novo link de contagem
          </CardTitle>
          <CardDescription>
            Gere links por grupo (todas as listagens) ou para uma listagem
            específica. Cada listagem usa seus próprios produtos e operador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={linkTarget}
                onValueChange={(v) => setLinkTarget(v as "group" | "listing")}
                disabled={loadingMeta}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">
                    Grupo (todas as listagens)
                  </SelectItem>
                  <SelectItem value="listing">Listagem específica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Grupo</Label>
              <Select
                value={targetGroupId || "__none__"}
                onValueChange={(v) =>
                  setTargetGroupId(v === "__none__" ? "" : v)
                }
                disabled={loadingMeta}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
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
          </div>
          {linkTarget === "listing" ? (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5" />
                Listagem
              </Label>
              <Select
                value={targetListingId || "__none__"}
                onValueChange={(v) =>
                  setTargetListingId(v === "__none__" ? "" : v)
                }
                disabled={loadingMeta}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a listagem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Selecione</SelectItem>
                  {listings
                    .filter((l) => l.inventory_count_group_id === targetGroupId)
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Button
            type="button"
            onClick={() => void createLinks()}
            disabled={loading || loadingMeta}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando…
              </>
            ) : (
              "Gerar link(s) de contagem"
            )}
          </Button>
          {links.length > 0 && (
            <div className="space-y-2">
              {links.map((row) => (
                <div
                  key={row.url}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <Input
                    readOnly
                    value={row.url}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copy(row.url)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={copyWhatsappMessage}
              >
                <Users className="mr-2 h-4 w-4" />
                Copiar mensagem para WhatsApp
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo grupo de contagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-group-name">Nome</Label>
            <Input
              id="new-group-name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Ex.: Cozinha, Depósito A, Inventário março"
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGroupDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void createGroup()}
              disabled={savingGroup}
            >
              {savingGroup ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Criar grupo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={listingDialogOpen} onOpenChange={setListingDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova listagem de contagem</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Grupo</Label>
              <Select
                value={selectedGroupId || "__none__"}
                onValueChange={(v) =>
                  setSelectedGroupId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o grupo" />
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
            <div className="space-y-2">
              <Label>Nome da listagem</Label>
              <Input
                value={newListingName}
                onChange={(e) => setNewListingName(e.target.value)}
                placeholder="Ex.: Cozinha fria, Prateleira A"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Operador vinculado (opcional)
              </Label>
              <Select
                value={newListingAssignedMemberId || "__none__"}
                onValueChange={(v) =>
                  setNewListingAssignedMemberId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
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
            </div>
            <div className="space-y-2">
              <Label>Produtos da listagem</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Buscar por nome ou SKU..."
                />
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                {filteredProducts.map((p) => {
                  const checked = selectedProductIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded border p-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {p.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.unit}
                          {p.sku ? ` · ${p.sku}` : ""}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedProductIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(p.id);
                            } else {
                              next.delete(p.id);
                            }
                            return next;
                          });
                        }}
                      />
                    </label>
                  );
                })}
                {filteredProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum produto encontrado.
                  </p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Selecionados: {selectedProductIds.size}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setListingDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void createListing()}
              disabled={savingListing}
            >
              {savingListing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Criar listagem"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={listingSheetOpen} onOpenChange={setListingSheetOpen}>
        <SheetContent className="flex h-full w-full max-w-xl flex-col gap-0 p-0">
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SheetTitle>
                  {listingSheetMode === "summary"
                    ? "Detalhes da listagem"
                    : "Editar listagem"}
                </SheetTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeListing?.name ?? "—"}
                </p>
              </div>
              <div className="flex gap-2">
                {listingSheetMode === "summary" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setListingSheetMode("edit")}
                  >
                    <Pencil className="mr-1.5 h-4 w-4" />
                    Editar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setListingSheetMode("summary")}
                  >
                    Voltar
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={
                    !activeListing || deletingListingId === activeListing.id
                  }
                  onClick={() =>
                    activeListing && void deleteListing(activeListing.id)
                  }
                >
                  {activeListing && deletingListingId === activeListing.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </SheetHeader>
          {listingSheetMode === "summary" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="space-y-3 rounded-md border p-4 text-sm">
                <p>
                  <span className="text-muted-foreground">Grupo:</span>{" "}
                  <span className="font-medium">
                    {groups.find(
                      (g) => g.id === activeListing?.inventory_count_group_id,
                    )?.name ?? "—"}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Operador:</span>{" "}
                  <span className="font-medium">
                    {members.find(
                      (m) => m.id === activeListing?.assigned_company_member_id,
                    )?.name ?? "Qualquer"}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Produtos:</span>{" "}
                  <span className="font-medium">
                    {activeListing
                      ? (productCountByListing.get(activeListing.id) ?? 0)
                      : 0}
                  </span>
                </p>
              </div>
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium">Itens da listagem</p>
                <ul className="max-h-80 space-y-2 overflow-y-auto rounded-md border p-2 text-sm">
                  {(activeListing
                    ? listingProductRows
                        .filter((r) => r.listing_id === activeListing.id)
                        .map(
                          (r) =>
                            products.find((p) => p.id === r.product_id)?.name ??
                            "—",
                        )
                    : []
                  ).map((name, idx) => (
                    <li
                      key={`${name}-${idx}`}
                      className="rounded border px-2 py-1"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
                <div className="space-y-2">
                  <Label>Nome da listagem</Label>
                  <Input
                    value={editListingName}
                    onChange={(e) => setEditListingName(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Grupo</Label>
                  <Select
                    value={editListingGroupId || "__none__"}
                    onValueChange={(v) =>
                      setEditListingGroupId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
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
                <div className="space-y-2">
                  <Label>Operador</Label>
                  <Select
                    value={editListingAssignedMemberId || "__none__"}
                    onValueChange={(v) =>
                      setEditListingAssignedMemberId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger>
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
                </div>
                <div className="space-y-2">
                  <Label>Produtos</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      value={editListingProductSearch}
                      onChange={(e) =>
                        setEditListingProductSearch(e.target.value)
                      }
                      placeholder="Buscar por nome ou SKU..."
                    />
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                    {filteredEditListingProducts.map((p) => {
                      const checked = editListingProductIds.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded border p-2 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {p.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {p.unit}
                              {p.sku ? ` · ${p.sku}` : ""}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setEditListingProductIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(p.id);
                                } else {
                                  next.delete(p.id);
                                }
                                return next;
                              });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <SheetFooter className="border-t px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setListingSheetMode("summary")}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  disabled={savingListingEdit}
                  onClick={() => void saveListingEdit()}
                >
                  {savingListingEdit ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    "Salvar alterações"
                  )}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <EstoqueHistoricoContagem
        companyId={companyId}
        refreshTrigger={historyTick}
      />
    </div>
  );
}

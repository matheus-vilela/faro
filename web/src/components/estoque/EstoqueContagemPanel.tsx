import { EstoqueAprovacaoContagem } from "@/components/estoque/EstoqueAprovacaoContagem";
import { EstoqueContagemAgendaTab } from "@/components/estoque/EstoqueContagemAgendaTab";
import { EstoqueContagemListasTab } from "@/components/estoque/EstoqueContagemListasTab";
import { EstoqueContagemListingSheet } from "@/components/estoque/EstoqueContagemListingSheet";
import {
  EstoqueContagemReuseDialog,
  type CountReusePrompt,
} from "@/components/estoque/EstoqueContagemReuseDialog";
import {
  EstoqueContagemScheduleDialog,
  type ScheduleDialogTarget,
} from "@/components/estoque/EstoqueContagemScheduleDialog";
import {
  EstoqueContagemSummaryCards,
  type ContagemTab,
} from "@/components/estoque/EstoqueContagemSummaryCards";
import { EstoqueHistoricoContagem } from "@/components/estoque/EstoqueHistoricoContagem";
import { Button } from "@/components/ui/button";
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
  activeSessionsForListing,
  listingActiveStatusById,
  listingHasPendingApproval,
  notifyInventoryCountSessions,
  openInventoryCountSessionFallback,
  processDueInventoryCountSchedules,
  publicUrlForSession,
  shouldAskToReuseCount,
  splitListingsForCountMode,
  type InventoryCountSessionSummary,
} from "@/lib/inventoryCount/createSession";
import { inventoryCountLineCount } from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
  InventoryCountSchedule,
} from "@/types/inventoryCount";
import type { Product } from "@/types/product";
import { CalendarClock, CheckCheck, ClipboardList, Copy, History, Loader2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type GeneratedLink = { label: string; url: string };

type CountExecuteMode = "create-all" | "reuse-and-fill";

export function EstoqueContagemPanel({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<ContagemTab>("aprovar");
  const [historyTick, setHistoryTick] = useState(0);

  const [groups, setGroups] = useState<InventoryCountGroup[]>([]);
  const [listings, setListings] = useState<InventoryCountListing[]>([]);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [listingProductRows, setListingProductRows] = useState<
    { listing_id: string; product_id: string }[]
  >([]);
  const [schedules, setSchedules] = useState<InventoryCountSchedule[]>([]);
  const [sessionSummary, setSessionSummary] = useState<
    InventoryCountSessionSummary[]
  >([]);
  const [reusePrompt, setReusePrompt] = useState<CountReusePrompt | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  const [listingSheetOpen, setListingSheetOpen] = useState(false);
  const [listingSheetMode, setListingSheetMode] = useState<"create" | "edit">(
    "create",
  );
  const [activeListingId, setActiveListingId] = useState("");
  const [listingSheetGroupId, setListingSheetGroupId] = useState("");
  const [listingSheetOneOff, setListingSheetOneOff] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleDialogTarget | null>(
    null,
  );
  const [scheduleExisting, setScheduleExisting] =
    useState<InventoryCountSchedule | null>(null);

  const [countingId, setCountingId] = useState("");
  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [linksOpen, setLinksOpen] = useState(false);

  const bump = () => setHistoryTick((t) => t + 1);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    const [gr, li, mem, prod, lprod, sch, sess] = await Promise.all([
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
        .is("archived_at", null)
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
      supabase.from("inventory_count_listing_products").select("listing_id, product_id"),
      supabase
        .from("inventory_count_schedules")
        .select("*")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("next_run_at", { ascending: true }),
      supabase
        .from("inventory_count_sessions")
        .select(
          "id, status, kind, inventory_count_listing_id, created_at, token, inventory_count_short_links(slug), inventory_count_lines(count)",
        )
        .eq("company_id", companyId)
        .in("status", ["open", "returned", "pending_approval"]),
    ]);
    if (gr.error) console.error(gr.error);
    if (li.error) console.error(li.error);
    if (sch.error) console.error(sch.error);
    setGroups((gr.data ?? []) as InventoryCountGroup[]);
    setListings((li.data ?? []) as InventoryCountListing[]);
    setMembers((mem.data ?? []) as CompanyMember[]);
    setProducts((prod.data ?? []) as Product[]);
    setListingProductRows(
      (lprod.data ?? []) as { listing_id: string; product_id: string }[],
    );
    setSchedules((sch.data ?? []) as InventoryCountSchedule[]);
    if (sess.error) console.error(sess.error);
    setSessionSummary((sess.data ?? []) as InventoryCountSessionSummary[]);
    setLoadingMeta(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void loadMeta());
  }, [loadMeta, historyTick]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        const ids = await processDueInventoryCountSchedules();
        if (cancelled) return;
        if (ids.length > 0) {
          await notifyInventoryCountSessions(ids);
          bump();
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const productCountByListing = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of listingProductRows) {
      out.set(row.listing_id, (out.get(row.listing_id) ?? 0) + 1);
    }
    return out;
  }, [listingProductRows]);

  const listingActiveStatus = useMemo(
    () => listingActiveStatusById(sessionSummary),
    [sessionSummary],
  );

  const pendingApproval = sessionSummary.filter(
    (s) =>
      s.status === "pending_approval" &&
      inventoryCountLineCount(s.inventory_count_lines) > 0,
  ).length;
  const inProgress = sessionSummary.filter(
    (s) => s.status === "open" || s.status === "returned",
  ).length;
  const onboardingPending = sessionSummary.filter((s) => {
    if (s.kind !== "onboarding") return false;
    if (s.status === "open" || s.status === "returned") return true;
    return (
      s.status === "pending_approval" &&
      inventoryCountLineCount(s.inventory_count_lines) > 0
    );
  }).length;

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
      toast.error(error.message ?? "Não foi possível criar o grupo.");
      return;
    }
    toast.success("Grupo criado. Monte a primeira listagem.");
    setNewGroupName("");
    setGroupDialogOpen(false);
    const gid = data?.id as string | undefined;
    await loadMeta();
    if (gid) {
      setListingSheetMode("create");
      setListingSheetOneOff(false);
      setListingSheetGroupId(gid);
      setActiveListingId("");
      setListingSheetOpen(true);
    }
  };

  const deleteGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const n = listings.filter((l) => l.inventory_count_group_id === groupId).length;
    const ok = window.confirm(
      n > 0
        ? `Remover o grupo "${group.name}" e ${n} listagem(ns)?`
        : `Remover o grupo "${group.name}"?`,
    );
    if (!ok) return;
    const { error } = await supabase
      .from("inventory_count_groups")
      .delete()
      .eq("id", groupId);
    if (error) {
      toast.error("Não foi possível remover o grupo.");
      return;
    }
    toast.success("Grupo removido.");
    await loadMeta();
  };

  const openCreateListing = (groupId: string) => {
    setListingSheetMode("create");
    setListingSheetOneOff(false);
    setListingSheetGroupId(groupId);
    setActiveListingId("");
    setListingSheetOpen(true);
  };

  const openCreateOneOff = () => {
    setListingSheetMode("create");
    setListingSheetOneOff(true);
    setListingSheetGroupId("");
    setActiveListingId("");
    setListingSheetOpen(true);
  };

  const openEditListing = (listingId: string) => {
    const listing = listings.find((l) => l.id === listingId);
    if (!listing) return;
    setListingSheetMode("edit");
    setListingSheetOneOff(!listing.inventory_count_group_id);
    setActiveListingId(listingId);
    setListingSheetGroupId(listing.inventory_count_group_id ?? "");
    setListingSheetOpen(true);
  };

  const activeListing =
    listings.find((l) => l.id === activeListingId) ?? null;
  const activeListingProductIds = listingProductRows
    .filter((r) => r.listing_id === activeListingId)
    .map((r) => r.product_id);

  const executeCount = async (
    rows: InventoryCountListing[],
    busyKey: string,
    mode: CountExecuteMode,
  ) => {
    const withProducts = rows.filter(
      (l) => (productCountByListing.get(l.id) ?? 0) > 0,
    );
    if (withProducts.length === 0) {
      toast.error("Não há listagens com produtos para contar.");
      return;
    }
    setCountingId(busyKey);
    try {
      const generated: GeneratedLink[] = [];
      const sessionIds: string[] = [];
      const { reuseIds } = splitListingsForCountMode(
        withProducts.map((l) => l.id),
        sessionSummary,
        mode,
      );
      const reuseSet = new Set(reuseIds);
      let reused = 0;
      for (const listing of withProducts) {
        const latest = reuseSet.has(listing.id)
          ? activeSessionsForListing(sessionSummary, listing.id)[0]
          : undefined;
        if (latest) {
          generated.push({
            label: listing.name,
            url: publicUrlForSession(latest),
          });
          reused += 1;
          continue;
        }
        const created = await openInventoryCountSessionFallback({
          companyId,
          groupId: listing.inventory_count_group_id,
          listingId: listing.id,
          assignedCompanyMemberId: listing.assigned_company_member_id,
        });
        generated.push({
          label: created.label || listing.name,
          url: created.url,
        });
        if (created.sessionId) sessionIds.push(created.sessionId);
      }
      setLinks(generated);
      setLinksOpen(true);
      if (sessionIds.length > 0) bump();
      const pendingNote = withProducts.some((l) =>
        listingHasPendingApproval(sessionSummary, l.id),
      );
      if (reused > 0 && sessionIds.length === 0) {
        toast.success(
          generated.length === 1
            ? "Link da contagem em andamento."
            : "Links das contagens em andamento.",
        );
      } else if (reused > 0) {
        toast.success("Links prontos. As listas abertas foram reutilizadas.");
      } else {
        toast.success(
          generated.length === 1
            ? "Link da listagem gerado."
            : "Links do grupo gerados (um por listagem).",
        );
      }
      if (pendingNote && sessionIds.length > 0) {
        toast.message("Já há uma desta lista aguardando conferência.");
      }
      await notifyInventoryCountSessions(sessionIds);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível gerar os links de contagem.");
    } finally {
      setCountingId("");
    }
  };

  const requestCount = (
    rows: InventoryCountListing[],
    busyKey: string,
  ) => {
    const withProducts = rows.filter(
      (l) => (productCountByListing.get(l.id) ?? 0) > 0,
    );
    if (withProducts.length === 0) {
      toast.error("Não há listagens com produtos para contar.");
      return;
    }
    const anyActive = shouldAskToReuseCount(
      withProducts.map((l) => l.id),
      sessionSummary,
    );
    if (!anyActive) {
      void executeCount(withProducts, busyKey, "create-all");
      return;
    }
    setReusePrompt({ listings: withProducts, busyKey });
  };

  const openSchedule = (target: ScheduleDialogTarget) => {
    const existing = schedules.find((s) => {
      if (target.listingId) {
        return s.inventory_count_listing_id === target.listingId;
      }
      return (
        s.inventory_count_group_id === target.groupId &&
        !s.inventory_count_listing_id
      );
    });
    setScheduleExisting(existing ?? null);
    setScheduleTarget(target);
    setScheduleOpen(true);
  };

  const openScheduleFromRow = (s: InventoryCountSchedule) => {
    const listing = s.inventory_count_listing_id
      ? listings.find((l) => l.id === s.inventory_count_listing_id)
      : null;
    if (listing) {
      openSchedule({
        groupId: listing.inventory_count_group_id,
        listingId: listing.id,
        defaultMemberId:
          s.assigned_company_member_id ?? listing.assigned_company_member_id,
        title: listing.inventory_count_group_id
          ? `Listagem: ${listing.name}`
          : `Lista única: ${listing.name}`,
        onceOnly: !listing.inventory_count_group_id,
      });
      return;
    }
    const group = s.inventory_count_group_id
      ? groups.find((g) => g.id === s.inventory_count_group_id)
      : null;
    openSchedule({
      groupId: s.inventory_count_group_id,
      listingId: null,
      defaultMemberId: s.assigned_company_member_id,
      title: group ? `Grupo: ${group.name}` : "Grupo",
    });
  };

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
      "Conte na unidade que vê na prateleira. O esperado fica oculto.",
    );
    void navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Mensagem de WhatsApp copiada.");
  };

  const tabs: { id: ContagemTab; label: string; icon: typeof CheckCheck }[] = [
    { id: "aprovar", label: "Aprovar", icon: CheckCheck },
    { id: "listas", label: "Listas", icon: ClipboardList },
    { id: "agenda", label: "Agenda", icon: CalendarClock },
    { id: "historico", label: "Histórico", icon: History },
  ];

  return (
    <div className="space-y-6">
      {onboardingPending > 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          Há uma <strong>contagem geral de onboarding</strong> pendente. O
          saldo importado só vale como estoque oficial depois de aprová-la.
          Notas fiscais reais continuam movimentando o cadastro.
        </p>
      ) : null}

      <EstoqueContagemSummaryCards
        pendingApproval={pendingApproval}
        inProgress={inProgress}
        scheduled={schedules.length}
        onboardingPending={onboardingPending}
        onSelect={(next) => setTab(next)}
      />

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-px"
        aria-label="Seções de contagem"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-border bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t.label}
              {t.id === "aprovar" && pendingApproval > 0 ? (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] tabular-nums">
                  {pendingApproval}
                </span>
              ) : null}
              {t.id === "agenda" && schedules.length > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
                  {schedules.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {tab === "aprovar" ? (
        <EstoqueAprovacaoContagem
          companyId={companyId}
          refreshTrigger={historyTick}
          onChanged={bump}
          highlightOnboarding={onboardingPending > 0}
        />
      ) : null}

      {tab === "listas" ? (
        <EstoqueContagemListasTab
          groups={groups}
          listings={listings}
          members={members}
          productCountByListing={productCountByListing}
          listingActiveStatus={listingActiveStatus}
          loading={loadingMeta}
          countingId={countingId}
          onNewGroup={() => setGroupDialogOpen(true)}
          onNewOneOff={openCreateOneOff}
          onDeleteGroup={(id) => void deleteGroup(id)}
          onNewListing={openCreateListing}
          onOpenListing={openEditListing}
          onCountGroup={(gid) =>
            requestCount(
              listings.filter((l) => l.inventory_count_group_id === gid),
              gid,
            )
          }
          onCountListing={(lid) => {
            const listing = listings.find((l) => l.id === lid);
            if (listing) requestCount([listing], lid);
          }}
          onProgramGroup={(gid) => {
            const g = groups.find((x) => x.id === gid);
            openSchedule({
              groupId: gid,
              listingId: null,
              defaultMemberId: null,
              title: g ? `Grupo: ${g.name}` : "Grupo",
            });
          }}
          onProgramListing={(lid) => {
            const listing = listings.find((l) => l.id === lid);
            if (!listing) return;
            openSchedule({
              groupId: listing.inventory_count_group_id,
              listingId: listing.id,
              defaultMemberId: listing.assigned_company_member_id,
              title: listing.inventory_count_group_id
                ? `Listagem: ${listing.name}`
                : `Lista única: ${listing.name}`,
              onceOnly: !listing.inventory_count_group_id,
            });
          }}
        />
      ) : null}

      {tab === "agenda" ? (
        <EstoqueContagemAgendaTab
          companyId={companyId}
          groups={groups}
          listings={listings}
          members={members}
          schedules={schedules}
          loading={loadingMeta}
          onEdit={openScheduleFromRow}
          onChanged={bump}
        />
      ) : null}

      {tab === "historico" ? (
        <EstoqueHistoricoContagem
          companyId={companyId}
          refreshTrigger={historyTick}
          onChanged={bump}
        />
      ) : null}

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
              placeholder="Ex.: Cozinha, Depósito A"
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">
              Depois de criar, você monta a primeira listagem (nome, operador e
              produtos). Não geramos lista vazia.
            </p>
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Criar grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EstoqueContagemListingSheet
        open={listingSheetOpen}
        onOpenChange={setListingSheetOpen}
        mode={listingSheetMode}
        companyId={companyId}
        groups={groups}
        members={members}
        products={products}
        listing={listingSheetMode === "edit" ? activeListing : null}
        listingProductIds={
          listingSheetMode === "edit" ? activeListingProductIds : []
        }
        defaultGroupId={listingSheetGroupId}
        oneOff={listingSheetOneOff}
        nextSortOrder={
          listingSheetOneOff
            ? listings.filter((l) => !l.inventory_count_group_id).length
            : listings.filter((l) => l.inventory_count_group_id === listingSheetGroupId)
                .length
        }
        onChanged={() => void loadMeta()}
        onProgramar={() => {
          if (!activeListing) return;
          openSchedule({
            groupId: activeListing.inventory_count_group_id,
            listingId: activeListing.id,
            defaultMemberId: activeListing.assigned_company_member_id,
            title: activeListing.inventory_count_group_id
              ? `Listagem: ${activeListing.name}`
              : `Lista única: ${activeListing.name}`,
            onceOnly: !activeListing.inventory_count_group_id,
          });
        }}
      />

      <EstoqueContagemScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        companyId={companyId}
        members={members}
        target={scheduleTarget}
        existing={scheduleExisting}
        onSaved={bump}
      />

      <EstoqueContagemReuseDialog
        prompt={reusePrompt}
        sessions={sessionSummary}
        busy={countingId.length > 0}
        onOpenChange={(open) => {
          if (!open) setReusePrompt(null);
        }}
        onReuse={() => {
          if (!reusePrompt) return;
          const { listings: rows, busyKey } = reusePrompt;
          setReusePrompt(null);
          void executeCount(rows, busyKey, "reuse-and-fill");
        }}
        onCreateNew={() => {
          if (!reusePrompt) return;
          const { listings: rows, busyKey } = reusePrompt;
          setReusePrompt(null);
          void executeCount(rows, busyKey, "create-all");
        }}
      />

      <Dialog open={linksOpen} onOpenChange={setLinksOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Links de contagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {links.map((row) => (
              <div
                key={row.url}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <Input readOnly value={row.url} className="font-mono text-sm" />
                </div>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={copyWhatsappMessage}>
              <Users className="mr-2 h-4 w-4" />
              Copiar mensagem para WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

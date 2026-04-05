import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Recebimento } from "@/types/recebimento";
import {
  Banknote,
  Calendar,
  Check,
  Hash,
  PackageCheck,
  PackageX,
  Share2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface ItemStatus {
  expense_item_id: string;
  status: "received" | "not_received" | "partial";
  quantity_received?: number | null;
}

type CompanyMemberRow = { id: string; name: string };

type RecebimentoStatusFilter = "all" | "pending" | "received";

export function Recebimento() {
  const { currentCompany, currentRole } = useCompany();
  const canAssignShare = currentRole === "owner" || currentRole === "gestor";
  const [recebimentos, setRecebimentos] = useState<Recebimento[]>([]);
  const [recebimentosCount, setRecebimentosCount] = useState(0);
  const [recebimentosPage, setRecebimentosPage] = useState(1);
  const [recebimentosSearch, setRecebimentosSearch] = useState("");
  const debouncedSearch = useDebounce(recebimentosSearch, 300);
  const [statusFilter, setStatusFilter] =
    useState<RecebimentoStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailRecebimento, setDetailRecebimento] =
    useState<Recebimento | null>(null);
  const [itemStatuses, setItemStatuses] = useState<ItemStatus[]>([]);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Recebimento | null>(null);
  const [shareMemberId, setShareMemberId] = useState<string>("");
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [savingShare, setSavingShare] = useState(false);
  const [openingOperadorId, setOpeningOperadorId] = useState<string | null>(
    null,
  );

  const openOperadorShortLink = async (r: { id: string }) => {
    setOpeningOperadorId(r.id);
    const { data: shortSlug, error: slugErr } = await supabase.rpc(
      "ensure_recebimento_short_slug",
      { p_recebimento_id: r.id },
    );
    setOpeningOperadorId(null);
    if (slugErr || !shortSlug) {
      toast.error(
        slugErr?.message ?? "Não foi possível abrir o link. Tente novamente.",
      );
      return;
    }
    window.open(
      `${window.location.origin}/s/${shortSlug}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const fetchRecebimentos = useCallback(async () => {
    if (!currentCompany?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: expensesData } = await supabase
      .from("expenses")
      .select("id")
      .eq("company_id", currentCompany.id)
      .or("expense_source.neq.whatsapp,status.eq.approved");
    const expenseIds = (expensesData ?? []).map((e) => e.id);
    if (expenseIds.length === 0) {
      setRecebimentos([]);
      setRecebimentosCount(0);
      setLoading(false);
      return;
    }
    let query = supabase
      .from("recebimentos")
      .select(
        `
        *,
        expenses (
          supplier_name,
          display_name,
          invoice_number,
          notes,
          expense_items (
            id,
            product_name,
            quantity,
            unit_value
          )
        ),
        recebimento_item_status (expense_item_id, status, quantity_received)
      `,
        { count: "exact" },
      )
      .in("expense_id", expenseIds)
      .order("updated_at", { ascending: false });
    if (statusFilter === "pending") {
      query = query.eq("status", "pending");
    } else if (statusFilter === "received") {
      query = query.eq("status", "received");
    }
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      const { data: expFilter } = await supabase
        .from("expenses")
        .select("id")
        .eq("company_id", currentCompany.id)
        .in("id", expenseIds)
        .or(
          `supplier_name.ilike.${term},display_name.ilike.${term},invoice_number.ilike.${term}`,
        );
      const filteredIds = (expFilter ?? []).map((e) => e.id);
      if (filteredIds.length > 0) {
        query = query.in("expense_id", filteredIds);
      } else {
        setRecebimentos([]);
        setRecebimentosCount(0);
        setLoading(false);
        return;
      }
    }
    const { data, count, error } = await query.range(
      (recebimentosPage - 1) * PAGE_SIZE,
      recebimentosPage * PAGE_SIZE - 1,
    );
    if (error) {
      toast.error(
        error.message.includes("assigned_company_member")
          ? "Atualize o banco (migration recebimento) ou recarregue em instantes."
          : "Erro ao carregar recebimentos: " + error.message,
      );
      setRecebimentos([]);
      setRecebimentosCount(0);
      setLoading(false);
      return;
    }
    let rows = (data ?? []) as Recebimento[];
    const memberIds = [
      ...new Set(
        rows
          .map((r) => r.assigned_company_member_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (memberIds.length > 0) {
      const { data: mems } = await supabase
        .from("company_members")
        .select("id, name")
        .in("id", memberIds);
      const map = new Map(
        (mems ?? []).map((m) => [m.id, { id: m.id, name: m.name }]),
      );
      rows = rows.map((r) => ({
        ...r,
        assigned_member: r.assigned_company_member_id
          ? (map.get(r.assigned_company_member_id) ?? null)
          : null,
      }));
    }
    setRecebimentos(rows);
    setRecebimentosCount(count ?? 0);
    setLoading(false);
  }, [currentCompany, debouncedSearch, recebimentosPage, statusFilter]);

  useEffect(() => {
    queueMicrotask(() => void fetchRecebimentos());
  }, [fetchRecebimentos]);

  useEffect(() => {
    if (!detailRecebimento?.id) return;
    const load = async () => {
      const { data } = await supabase
        .from("recebimento_item_status")
        .select("expense_item_id, status, quantity_received")
        .eq("recebimento_id", detailRecebimento.id);
      setItemStatuses((data ?? []) as ItemStatus[]);
    };
    load();
  }, [detailRecebimento?.id]);

  const openShareDialog = (r: Recebimento) => {
    setShareTarget(r);
    setShareMemberId(r.assigned_company_member_id ?? "");
    setShareDialogOpen(true);
  };

  useEffect(() => {
    if (!shareDialogOpen || !currentCompany?.id) return;
    let cancelled = false;
    queueMicrotask(() => setLoadingMembers(true));
    void (async () => {
      const { data: members, error } = await supabase
        .from("company_members")
        .select("id, name")
        .eq("company_id", currentCompany.id)
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      setLoadingMembers(false);
      if (error) {
        toast.error("Não foi possível carregar os membros.");
        setCompanyMembers([]);
        return;
      }
      setCompanyMembers((members as CompanyMemberRow[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [shareDialogOpen, currentCompany?.id]);

  const copyShareLink = async () => {
    if (!shareTarget || !currentCompany?.id) return;
    if (!shareMemberId) {
      toast.error("Selecione o membro de referência para este recebimento.");
      return;
    }
    setSavingShare(true);
    const { data: res, error } = await supabase.rpc(
      "set_recebimento_assigned_member",
      {
        p_recebimento_id: shareTarget.id,
        p_company_member_id: shareMemberId,
      },
    );
    setSavingShare(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const out = res as { success?: boolean; error?: string };
    if (!out?.success) {
      toast.error(
        out?.error === "Sem permissão"
          ? "Apenas proprietário ou gestor podem vincular o membro."
          : (out?.error ?? "Não foi possível salvar o vínculo."),
      );
      return;
    }
    const { data: shortSlug, error: slugErr } = await supabase.rpc(
      "ensure_recebimento_short_slug",
      { p_recebimento_id: shareTarget.id },
    );
    if (slugErr || !shortSlug) {
      toast.error(
        slugErr?.message ??
          "Não foi possível gerar o link curto. Tente novamente.",
      );
      return;
    }
    const url = `${window.location.origin}/s/${shortSlug}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(shareTarget.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(
      "Link copiado. Qualquer pessoa com o link pode confirmar; o membro é só referência.",
    );
    setShareDialogOpen(false);
    setShareTarget(null);
    void fetchRecebimentos();
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        icon={PackageCheck}
        title="Recebimento de mercadorias"
        description="Você pode associar um membro da empresa ao recebimento da mercadoria. Qualquer pessoa com o link pode confirmar."
      />

      <Card className="overflow-hidden">
        <CardContent className="">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-start">
            <div className="flex flex-col gap-1.5 sm:min-w-[240px] ">
              <Label htmlFor="recebimento-search" className="text-xs">
                Buscar
              </Label>
              <Input
                id="recebimento-search"
                placeholder="Filtrar por fornecedor ou nota..."
                value={recebimentosSearch}
                onChange={(e) => {
                  setRecebimentosSearch(e.target.value);
                  setRecebimentosPage(1);
                }}
                className="max-w-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:min-w-[220px]">
              <Label htmlFor="recebimento-status" className="text-xs">
                Situação
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as RecebimentoStatusFilter);
                  setRecebimentosPage(1);
                }}
              >
                <SelectTrigger id="recebimento-status" className="w-full">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Somente pendentes</SelectItem>
                  <SelectItem value="received">Somente confirmados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1 mb-4">
            Ordenados pela última atualização do recebimento.
          </p>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : recebimentos.length === 0 ? (
            <p className="text-muted-foreground">
              {statusFilter === "pending"
                ? "Nenhum recebimento pendente no momento."
                : statusFilter === "received"
                  ? "Nenhum recebimento confirmado encontrado."
                  : "Nenhum card de recebimento. As despesas criadas geram cards automaticamente."}
            </p>
          ) : (
            <div className="space-y-3">
              {recebimentos.map((r) => {
                const exp = r.expenses as Recebimento["expenses"];
                const items = exp?.expense_items ?? [];
                const total = items.reduce(
                  (s, it) => s + Number(it.quantity) * Number(it.unit_value),
                  0,
                );
                const isReceived = r.status === "received";
                const itemStatusesList = (r.recebimento_item_status ??
                  []) as ItemStatus[];
                const hasPendingReceipt =
                  isReceived &&
                  itemStatusesList.some(
                    (s) =>
                      s.status === "not_received" || s.status === "partial",
                  );
                const badgeLabel = !isReceived
                  ? "Pendente"
                  : hasPendingReceipt
                    ? "Com pendências"
                    : "Confirmado";
                const statusStripe = !isReceived
                  ? "bg-muted-foreground/35"
                  : hasPendingReceipt
                    ? "bg-amber-500"
                    : "bg-emerald-600";
                const title =
                  exp?.display_name?.trim() ||
                  exp?.supplier_name ||
                  "Sem fornecedor";
                return (
                  <div
                    key={r.id}
                    role={isReceived ? "button" : undefined}
                    tabIndex={isReceived ? 0 : undefined}
                    onClick={
                      isReceived
                        ? () => {
                            setDetailRecebimento(r);
                            setItemStatuses([]);
                          }
                        : undefined
                    }
                    onKeyDown={
                      isReceived
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              setDetailRecebimento(r);
                              setItemStatuses([]);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "rounded-xl border bg-card text-left shadow-sm transition-[box-shadow,background-color]",
                      isReceived &&
                        "cursor-pointer hover:bg-muted/40 hover:shadow-md",
                    )}
                  >
                    <div
                      className={cn("h-1 rounded-t-[inherit]", statusStripe)}
                      aria-hidden
                    />
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 flex-1 gap-3">
                          <div
                            className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
                              !isReceived &&
                                "bg-muted/80 text-muted-foreground",
                              isReceived &&
                                !hasPendingReceipt &&
                                "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                              isReceived &&
                                hasPendingReceipt &&
                                "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                            )}
                          >
                            <PackageCheck className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3">
                              <div className="min-w-0">
                                <p className="font-semibold leading-snug text-foreground">
                                  {title}
                                </p>
                                {exp?.invoice_number && (
                                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Hash className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    Nota {exp.invoice_number}
                                  </p>
                                )}
                              </div>
                              <Badge
                                variant={isReceived ? "default" : "secondary"}
                                className={cn(
                                  "shrink-0 self-start sm:self-center",
                                  isReceived &&
                                    !hasPendingReceipt &&
                                    "bg-emerald-600 hover:bg-emerald-600/90",
                                  isReceived &&
                                    hasPendingReceipt &&
                                    "bg-amber-600 hover:bg-amber-600/90",
                                )}
                              >
                                {badgeLabel}
                              </Badge>
                            </div>

                            <dl
                              className={cn(
                                "grid grid-cols-2 gap-3 text-sm",
                                r.assigned_company_member_id
                                  ? "sm:grid-cols-4"
                                  : "sm:grid-cols-3",
                              )}
                            >
                              <div className="space-y-0.5">
                                <dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  <Calendar className="h-3.5 w-3.5" />
                                  Criado
                                </dt>
                                <dd className="tabular-nums text-foreground">
                                  {formatDate(r.created_at)}
                                </dd>
                              </div>
                              <div className="space-y-0.5">
                                <dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  <Banknote className="h-3.5 w-3.5" />
                                  Total
                                </dt>
                                <dd className="font-medium tabular-nums text-foreground">
                                  {formatCurrency(total)}
                                </dd>
                              </div>
                              <div className="space-y-0.5">
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Itens
                                </dt>
                                <dd className="tabular-nums text-foreground">
                                  {items.length}{" "}
                                  {items.length === 1 ? "item" : "itens"}
                                </dd>
                              </div>
                              {r.assigned_company_member_id ? (
                                <div className="col-span-2 space-y-0.5 sm:col-span-1">
                                  <dt className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <User className="h-3.5 w-3.5" />
                                    Referência
                                  </dt>
                                  <dd className="truncate text-foreground">
                                    {r.assigned_member?.name?.trim() || "—"}
                                  </dd>
                                </div>
                              ) : null}
                            </dl>

                            {hasPendingReceipt && (
                              <p className="rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
                                Há itens com falta ou recebimento parcial — abra
                                o card para ver o detalhe.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div
                        className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isReceived && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canAssignShare}
                            title={
                              !canAssignShare
                                ? "Apenas proprietário ou gestor podem vincular um membro ao link"
                                : undefined
                            }
                            onClick={() => openShareDialog(r)}
                          >
                            {copiedId === r.id ? (
                              <>
                                <Check className="h-4 w-4 mr-2 text-green-600" />
                                Link copiado!
                              </>
                            ) : (
                              <>
                                <Share2 className="h-4 w-4 mr-2" />
                                Vincular operador
                              </>
                            )}
                          </Button>
                        )}
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/app/despesas?expense=${r.expense_id}`}>
                            Ver despesa
                          </Link>
                        </Button>
                        {!isReceived && (
                          <Button
                            size="sm"
                            disabled={openingOperadorId === r.id}
                            onClick={() => void openOperadorShortLink(r)}
                          >
                            Abrir link do operador
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && (
            <Pagination
              page={recebimentosPage}
              totalCount={recebimentosCount}
              onPageChange={setRecebimentosPage}
            />
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!detailRecebimento}
        onOpenChange={(open) => {
          if (!open) {
            setDetailRecebimento(null);
            setItemStatuses([]);
          }
        }}
      >
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {detailRecebimento &&
            (() => {
              const exp = detailRecebimento.expenses as Recebimento["expenses"];
              const items = exp?.expense_items ?? [];
              const total = items.reduce(
                (s, it) => s + Number(it.quantity) * Number(it.unit_value),
                0,
              );
              const rowByItem = new Map(
                itemStatuses.map((s) => [s.expense_item_id, s]),
              );
              const receivedCount = itemStatuses.filter(
                (s) => s.status === "received",
              ).length;
              const partialCount = itemStatuses.filter(
                (s) => s.status === "partial",
              ).length;
              const notReceivedCount = itemStatuses.filter(
                (s) => s.status === "not_received",
              ).length;

              return (
                <>
                  <SheetHeader>
                    <SheetTitle>Resumo do recebimento</SheetTitle>
                    <SheetDescription>
                      Dados da despesa e report do operador
                    </SheetDescription>
                  </SheetHeader>
                  <div className="space-y-6 py-4">
                    <div>
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">
                        Despesa
                      </h3>
                      <div className="space-y-1">
                        <p className="font-medium">
                          {exp?.display_name?.trim() ||
                            exp?.supplier_name ||
                            "Sem fornecedor"}
                        </p>
                        {exp?.invoice_number && (
                          <p className="text-sm text-muted-foreground">
                            Nota {exp.invoice_number}
                          </p>
                        )}
                        {exp?.notes && (
                          <p className="text-sm text-muted-foreground">
                            {exp.notes}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {formatDate(detailRecebimento.created_at)} •{" "}
                          {formatCurrency(total)}
                        </p>
                        {(detailRecebimento as { received_at?: string | null })
                          .received_at && (
                          <p className="text-sm text-green-600 dark:text-green-500">
                            Confirmado em{" "}
                            {formatDate(
                              (detailRecebimento as { received_at?: string })
                                .received_at!,
                            )}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-medium text-sm text-muted-foreground mb-2">
                        Report do operador
                      </h3>
                      <div className="rounded-lg border bg-muted/30 p-3 mb-3">
                        <p className="text-sm flex flex-wrap gap-x-1 gap-y-0.5">
                          <span className="text-green-600 dark:text-green-500 font-medium">
                            {receivedCount} completo(s)
                          </span>
                          {partialCount > 0 && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-amber-600 font-medium">
                                {partialCount} parcial(is)
                              </span>
                            </>
                          )}
                          {notReceivedCount > 0 && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-destructive font-medium">
                                {notReceivedCount} não recebido(s)
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {items.map((it) => {
                          const row = rowByItem.get(it.id);
                          const status = row?.status ?? "received";
                          const isNotReceived = status === "not_received";
                          const isPartial = status === "partial";
                          const ordered = Number(it.quantity);
                          const qRec =
                            row?.quantity_received != null
                              ? Number(row.quantity_received)
                              : status === "received"
                                ? ordered
                                : 0;
                          const missing = Math.max(0, ordered - qRec);

                          return (
                            <div
                              key={it.id}
                              className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between ${
                                isNotReceived
                                  ? "border-destructive/50 bg-destructive/5"
                                  : isPartial
                                    ? "border-amber-500/40 bg-amber-500/5"
                                    : "bg-muted/20"
                              }`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                {isNotReceived ? (
                                  <PackageX className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                ) : isPartial ? (
                                  <PackageCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                ) : (
                                  <PackageCheck className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
                                )}
                                <div className="min-w-0">
                                  <p className="font-medium truncate">
                                    {it.product_name || "—"}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    Pedido: {ordered.toLocaleString("pt-BR")} un
                                    × {formatCurrency(Number(it.unit_value))}
                                  </p>
                                  {isPartial && (
                                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                                      Recebido {qRec.toLocaleString("pt-BR")} un
                                      {missing > 0 && (
                                        <>
                                          {" "}
                                          — faltam{" "}
                                          {missing.toLocaleString("pt-BR")} un
                                        </>
                                      )}
                                    </p>
                                  )}
                                  {isNotReceived && (
                                    <p className="text-sm text-destructive mt-1">
                                      Faltam {ordered.toLocaleString("pt-BR")}{" "}
                                      un
                                    </p>
                                  )}
                                </div>
                              </div>
                              <Badge
                                variant={
                                  isNotReceived
                                    ? "destructive"
                                    : isPartial
                                      ? "secondary"
                                      : "secondary"
                                }
                                className={
                                  isNotReceived
                                    ? ""
                                    : isPartial
                                      ? "bg-amber-600/20 text-amber-800 dark:text-amber-300 shrink-0"
                                      : "bg-green-600/20 text-green-700 dark:text-green-400 shrink-0"
                                }
                              >
                                {isNotReceived
                                  ? "Não recebido"
                                  : isPartial
                                    ? "Parcial"
                                    : "Recebido"}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <Button asChild variant="outline" className="w-full">
                      <Link
                        to={`/app/despesas?expense=${detailRecebimento.expense_id}`}
                        onClick={() => {
                          setDetailRecebimento(null);
                          setItemStatuses([]);
                        }}
                      >
                        Ver despesa completa
                      </Link>
                    </Button>
                  </div>
                </>
              );
            })()}
        </SheetContent>
      </Sheet>

      <Dialog
        open={shareDialogOpen}
        onOpenChange={(open) => {
          setShareDialogOpen(open);
          if (!open) setShareTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Compartilhar link de recebimento</DialogTitle>
            <DialogDescription>
              Associe um membro cadastrado na empresa a este recebimento (só
              referência para relatórios). Qualquer pessoa com o link pode
              confirmar o recebimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="share-member">Membro de referência</Label>
              <Select
                value={shareMemberId || undefined}
                onValueChange={setShareMemberId}
                disabled={loadingMembers}
              >
                <SelectTrigger id="share-member" className="w-full">
                  <SelectValue
                    placeholder={
                      loadingMembers
                        ? "Carregando membros…"
                        : "Selecione um membro"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {companyMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name?.trim() || m.id.slice(0, 8) + "…"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingMembers && companyMembers.length === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  Não há membros cadastrados em Configurações. Cadastre membros
                  para poder vincular ao recebimento.
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void copyShareLink()}
              disabled={
                savingShare ||
                loadingMembers ||
                companyMembers.length === 0 ||
                !shareMemberId
              }
            >
              {savingShare ? "Salvando…" : "Vincular e copiar o link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

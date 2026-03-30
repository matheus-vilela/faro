import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Pagination, PAGE_SIZE } from "@/components/Pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/lib/supabase";
import type { Recebimento } from "@/types/recebimento";
import { toast } from "sonner";
import { Check, PackageCheck, PackageX, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface ItemStatus {
  expense_item_id: string;
  status: "received" | "not_received";
}

type CompanyMemberRow = { id: string; name: string };

export function Recebimento() {
  const { currentCompany, currentRole } = useCompany();
  const canAssignShare =
    currentRole === "owner" || currentRole === "gestor";
  const [recebimentos, setRecebimentos] = useState<Recebimento[]>([]);
  const [recebimentosCount, setRecebimentosCount] = useState(0);
  const [recebimentosPage, setRecebimentosPage] = useState(1);
  const [recebimentosSearch, setRecebimentosSearch] = useState("");
  const debouncedSearch = useDebounce(recebimentosSearch, 300);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailRecebimento, setDetailRecebimento] = useState<Recebimento | null>(
    null,
  );
  const [itemStatuses, setItemStatuses] = useState<ItemStatus[]>([]);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Recebimento | null>(null);
  const [shareMemberId, setShareMemberId] = useState<string>("");
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberRow[]>(
    [],
  );
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
      .eq("company_id", currentCompany.id);
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
        recebimento_item_status (expense_item_id, status)
      `,
        { count: "exact" },
      )
      .in("expense_id", expenseIds)
      .order("created_at", { ascending: false });
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      const { data: expFilter } = await supabase
        .from("expenses")
        .select("id")
        .eq("company_id", currentCompany.id)
        .or(`supplier_name.ilike.${term},display_name.ilike.${term},invoice_number.ilike.${term}`);
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
    const { data, count, error } = await query
      .range((recebimentosPage - 1) * PAGE_SIZE, recebimentosPage * PAGE_SIZE - 1);
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
          ? map.get(r.assigned_company_member_id) ?? null
          : null,
      }));
    }
    setRecebimentos(rows);
    setRecebimentosCount(count ?? 0);
    setLoading(false);
  }, [currentCompany, debouncedSearch, recebimentosPage]);

  useEffect(() => {
    queueMicrotask(() => void fetchRecebimentos());
  }, [fetchRecebimentos]);

  useEffect(() => {
    if (!detailRecebimento?.id) return;
    const load = async () => {
      const { data } = await supabase
        .from("recebimento_item_status")
        .select("expense_item_id, status")
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
    setLoadingMembers(true);
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
          : out?.error ?? "Não foi possível salvar o vínculo.",
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Recebimento</h1>
        <p className="text-muted-foreground">
          Ao compartilhar o link, você pode associar um membro da empresa ao
          recebimento (referência). Qualquer pessoa com o link pode confirmar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Cards de recebimento
          </CardTitle>
          <CardDescription>
            Cada despesa gera um card. Use &quot;Compartilhar link&quot; para
            vincular um membro (referência) e copiar o endereço (proprietário ou
            gestor).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Filtrar por fornecedor ou nota..."
              value={recebimentosSearch}
              onChange={(e) => {
                setRecebimentosSearch(e.target.value);
                setRecebimentosPage(1);
              }}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : recebimentos.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum card de recebimento. As despesas criadas geram cards
              automaticamente.
            </p>
          ) : (
            <div className="space-y-4">
              {recebimentos.map((r) => {
                const exp = r.expenses as Recebimento["expenses"];
                const items = exp?.expense_items ?? [];
                const total = items.reduce(
                  (s, it) => s + Number(it.quantity) * Number(it.unit_value),
                  0,
                );
                const isReceived = r.status === "received";
                const itemStatusesList = (r.recebimento_item_status ?? []) as ItemStatus[];
                const hasNotReceived = isReceived && itemStatusesList.some(
                  (s) => s.status === "not_received",
                );
                const badgeLabel = !isReceived
                  ? "Pendente"
                  : hasNotReceived
                    ? "Confirmado parcialmente"
                    : "Confirmado";
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
                    className={`rounded-lg border p-4 space-y-3 ${
                      isReceived
                        ? "cursor-pointer hover:bg-muted/50 transition-colors"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {exp?.display_name?.trim() || exp?.supplier_name || "Sem fornecedor"}
                          </span>
                          {exp?.invoice_number && (
                            <span className="text-sm text-muted-foreground">
                              Nota {exp.invoice_number}
                            </span>
                          )}
                          <Badge
                            variant={isReceived ? "default" : "secondary"}
                            className={
                              isReceived
                                ? hasNotReceived
                                  ? "bg-amber-600"
                                  : "bg-green-600"
                                : ""
                            }
                          >
                            {badgeLabel}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDate(r.created_at)} • {items.length} item(ns) •{" "}
                          {formatCurrency(total)}
                          {r.assigned_company_member_id && (
                            <span className="block sm:inline sm:ml-1 mt-0.5 sm:mt-0 text-foreground/90">
                              • Membro (ref.):{" "}
                              {r.assigned_member?.name?.trim() || "—"}
                            </span>
                          )}
                          {hasNotReceived && (
                            <span className="text-amber-600 dark:text-amber-500 font-medium ml-1">
                              • Teve itens não recebidos
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                                Compartilhar link
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
          {detailRecebimento && (() => {
            const exp = detailRecebimento.expenses as Recebimento["expenses"];
            const items = exp?.expense_items ?? [];
            const total = items.reduce(
              (s, it) =>
                s + Number(it.quantity) * Number(it.unit_value),
              0,
            );
            const statusByItem = new Map(
              itemStatuses.map((s) => [s.expense_item_id, s.status]),
            );
            const receivedCount = itemStatuses.filter(
              (s) => s.status === "received",
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
                        {exp?.display_name?.trim() || exp?.supplier_name || "Sem fornecedor"}
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
                      <p className="text-sm">
                        <span className="text-green-600 dark:text-green-500 font-medium">
                          {receivedCount} recebido(s)
                        </span>
                        {notReceivedCount > 0 && (
                          <>
                            {" • "}
                            <span className="text-destructive font-medium">
                              {notReceivedCount} não recebido(s)
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {items.map((it) => {
                        const status =
                          statusByItem.get(it.id) ?? "received";
                        const isNotReceived =
                          status === "not_received";

                        return (
                          <div
                            key={it.id}
                            className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                              isNotReceived
                                ? "border-destructive/50 bg-destructive/5"
                                : "bg-muted/20"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {isNotReceived ? (
                                <PackageX className="h-4 w-4 text-destructive shrink-0" />
                              ) : (
                                <PackageCheck className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium truncate">
                                  {it.product_name || "—"}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {Number(it.quantity).toLocaleString("pt-BR")}{" "}
                                  un ×{" "}
                                  {formatCurrency(Number(it.unit_value))}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant={
                                isNotReceived ? "destructive" : "secondary"
                              }
                              className={
                                isNotReceived
                                  ? ""
                                  : "bg-green-600/20 text-green-700 dark:text-green-400"
                              }
                            >
                              {isNotReceived
                                ? "Não recebido"
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
          <DialogFooter className="gap-2 sm:gap-0">
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
              {savingShare ? "Salvando…" : "Copiar link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

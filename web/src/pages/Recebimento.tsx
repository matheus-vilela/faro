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
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/lib/supabase";
import type { Recebimento } from "@/types/recebimento";
import { Check, PackageCheck, PackageX, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface ItemStatus {
  expense_item_id: string;
  status: "received" | "not_received";
}

export function Recebimento() {
  const { currentCompany } = useCompany();
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

  const fetchRecebimentos = useCallback(async () => {
    if (!currentCompany?.id) return;
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
    const { data, count } = await query
      .range((recebimentosPage - 1) * PAGE_SIZE, recebimentosPage * PAGE_SIZE - 1);
    setRecebimentos((data ?? []) as Recebimento[]);
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

  const shareLink = async (r: Recebimento) => {
    const url = `${window.location.origin}/confirmar-recebimento/${r.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(null), 2000);
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
          Confirme o recebimento de mercadorias – compartilhe o link com o
          operador
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Cards de recebimento
          </CardTitle>
          <CardDescription>
            Cada despesa gera um card. Compartilhe o link para o operador
            validar os itens ao receber.
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
                            onClick={() => shareLink(r)}
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
                          <Button asChild size="sm">
                            <a
                              href={`/confirmar-recebimento/${r.token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Abrir link do operador
                            </a>
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
    </div>
  );
}

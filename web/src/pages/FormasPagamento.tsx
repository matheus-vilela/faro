import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  nestedRelation,
  type CompanyAcquirer,
} from "@/types/acquirer";
import { CreditCard, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const NO_ACQUIRER = "__none__";

type PaymentMethodRow = {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
  include_in_net_sales: boolean;
  created_at: string;
  acquirer_id: string | null;
  acquirer_name: string | null;
};

export function FormasPagamento() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [rows, setRows] = useState<PaymentMethodRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSku, setCreateSku] = useState("");
  const [createName, setCreateName] = useState("");
  const [createAcquirerId, setCreateAcquirerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<PaymentMethodRow | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [acquirers, setAcquirers] = useState<CompanyAcquirer[]>([]);

  const load = useCallback(async () => {
    if (!companyId) {
      setRows([]);
      setCount(0);
      return;
    }
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let q = supabase
      .from("payment_methods")
      .select(
        "id, sku, name, is_active, include_in_net_sales, created_at, acquirer_id, acquirers ( id, name )",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .range(from, to);
    const term = debouncedSearch.trim();
    if (term) {
      q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
    }
    const { data, error, count: c } = await q;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows(
      (
        (data ?? []) as Array<
          Omit<PaymentMethodRow, "acquirer_name"> & {
            acquirers?: { id: string; name: string } | { id: string; name: string }[] | null;
          }
        >
      ).map((r) => {
        const acquirer = nestedRelation(r.acquirers);
        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          is_active: r.is_active,
          include_in_net_sales: r.include_in_net_sales !== false,
          created_at: r.created_at,
          acquirer_id: r.acquirer_id ?? acquirer?.id ?? null,
          acquirer_name: acquirer?.name ?? null,
        };
      }),
    );
    setCount(c ?? 0);
  }, [companyId, page, debouncedSearch]);

  const loadAcquirers = useCallback(async () => {
    if (!companyId) {
      setAcquirers([]);
      return;
    }
    const { data, error } = await supabase
      .from("acquirers")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAcquirers((data ?? []) as CompanyAcquirer[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    queueMicrotask(() => void loadAcquirers());
  }, [loadAcquirers]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const createMethod = async () => {
    if (!companyId) return;
    const sku = createSku.trim();
    const name = createName.trim();
    if (!sku || !name) {
      toast.error("Informe SKU e nome.");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("payment_methods").insert({
      company_id: companyId,
      sku,
      name,
      is_active: true,
      include_in_net_sales: true,
      acquirer_id: createAcquirerId,
    });
    setCreating(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Já existe uma forma de pagamento com este SKU."
          : error.message,
      );
      return;
    }
    toast.success("Forma de pagamento criada.");
    setCreateOpen(false);
    setCreateSku("");
    setCreateName("");
    setCreateAcquirerId(null);
    void load();
  };

  const saveDetail = async () => {
    if (!detail || !companyId) return;
    const name = detail.name.trim();
    if (!name) {
      toast.error("Nome é obrigatório.");
      return;
    }
    setSavingDetail(true);
    const { error } = await supabase
      .from("payment_methods")
      .update({
        name,
        is_active: detail.is_active,
        include_in_net_sales: detail.include_in_net_sales,
        acquirer_id: detail.acquirer_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detail.id)
      .eq("company_id", companyId);
    setSavingDetail(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Forma de pagamento atualizada.");
    setDetail(null);
    void load();
  };

  return (
    <PageShell className="flex min-h-0 flex-1 flex-col gap-4 pb-0">
      <PageHeader
        title="Formas de pagamento"
        description="Catálogo usado no faturamento EPOC. Associe a adquirente e defina se a forma entra na venda líquida."
        icon={CreditCard}
        className="shrink-0"
        action={
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova forma
          </Button>
        }
      />

      <div className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card/60 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-4">
        <Input
          placeholder="Filtrar por nome ou SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 min-w-0 flex-1 sm:max-w-xs"
        />
      </div>

      <div className="flex min-h-[min(28rem,calc(100dvh-22rem))] flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="hidden shrink-0 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,8rem)_minmax(0,10rem)_5.5rem] md:gap-3">
          <span>Nome</span>
          <span>SKU</span>
          <span>Adquirente</span>
          <span>Status</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              Carregando...
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              {debouncedSearch.trim()
                ? "Nenhuma forma de pagamento encontrada para este filtro."
                : "Nenhuma forma de pagamento cadastrada. Elas surgem ao sincronizar o faturamento EPOC, ou pode criar manualmente."}
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetail(row);
                    }
                  }}
                  className={cn(
                    "group border-l-[3px] bg-card outline-none transition-colors",
                    "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    row.is_active
                      ? "border-l-emerald-600/80"
                      : "border-l-muted-foreground/35",
                  )}
                >
                  <div className="hidden md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,8rem)_minmax(0,10rem)_5.5rem] md:items-center md:gap-3 md:px-4 md:py-2.5">
                    <p className="truncate text-sm font-semibold leading-tight tracking-tight">
                      {row.name}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {row.sku}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {row.acquirer_name ?? "—"}
                    </p>
                    <div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-normal",
                          row.is_active
                            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {row.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5 px-3 py-3 md:hidden">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold leading-snug">
                        {row.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {row.sku}
                        {row.acquirer_name ? ` · ${row.acquirer_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-normal",
                          row.is_active
                            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {row.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                      {row.acquirer_name ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal"
                        >
                          {row.acquirer_name}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading ? (
          <div className="shrink-0 border-t px-2 py-2 sm:px-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={count}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="flex flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Nova forma de pagamento</SheetTitle>
            <SheetDescription>
              Use o mesmo SKU do EPOC para evitar duplicidade na sincronização.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-sku">SKU</Label>
              <Input
                id="pm-sku"
                value={createSku}
                onChange={(e) => setCreateSku(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-name">Nome</Label>
              <Input
                id="pm-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Adquirente</Label>
              <Select
                value={createAcquirerId ?? NO_ACQUIRER}
                onValueChange={(v) =>
                  setCreateAcquirerId(v === NO_ACQUIRER ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACQUIRER}>Nenhuma</SelectItem>
                  {acquirers
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {acquirers.filter((a) => a.is_active).length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Cadastre em{" "}
                  <Link
                    to="/app/configuracoes/adquirentes"
                    className="underline-offset-4 hover:underline"
                  >
                    Adquirentes
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={creating}
              onClick={() => void createMethod()}
            >
              {creating ? "A guardar…" : "Criar"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      >
        <SheetContent className="flex flex-col gap-4 sm:max-w-md">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>Forma de pagamento</SheetTitle>
                <SheetDescription className="font-mono">
                  {detail.sku}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pm-edit-name">Nome</Label>
                  <Input
                    id="pm-edit-name"
                    value={detail.name}
                    onChange={(e) =>
                      setDetail({ ...detail, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Adquirente</Label>
                  <Select
                    value={detail.acquirer_id ?? NO_ACQUIRER}
                    onValueChange={(v) =>
                      setDetail({
                        ...detail,
                        acquirer_id: v === NO_ACQUIRER ? null : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACQUIRER}>Nenhuma</SelectItem>
                      {acquirers
                        .filter(
                          (a) => a.is_active || a.id === detail.acquirer_id,
                        )
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                            {!a.is_active ? " (inativa)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    <Link
                      to="/app/configuracoes/adquirentes"
                      className="underline-offset-4 hover:underline"
                    >
                      Gerir adquirentes
                    </Link>
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <Label htmlFor="pm-active">Ativa</Label>
                  <Switch
                    id="pm-active"
                    checked={detail.is_active}
                    onCheckedChange={(v) =>
                      setDetail({ ...detail, is_active: v })
                    }
                  />
                </div>
                <div className="space-y-1.5 rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="pm-net-sales">Contabilizar na venda líquida</Label>
                    <Switch
                      id="pm-net-sales"
                      checked={detail.include_in_net_sales}
                      onCheckedChange={(v) =>
                        setDetail({ ...detail, include_in_net_sales: v })
                      }
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Desative para formas como reembolso: o valor continua
                    visível no faturamento, mas não entra no total líquido nem
                    em relatórios de receita futuros (DRE etc.).
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  O SKU não pode ser alterado (chave do relatório EPOC).
                </p>
              </div>
              <SheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDetail(null)}
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  disabled={savingDetail}
                  onClick={() => void saveDetail()}
                >
                  {savingDetail ? "A guardar…" : "Guardar"}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

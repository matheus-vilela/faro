import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import {
  formatIsoDateBr,
  formatMoneyPtBr,
  formatNumberPtBr,
} from "@/lib/formatMoneyPtBr";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ConciergeBell, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type ServiceRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type DailySaleRow = {
  id: string;
  sale_date: string;
  quantity: number;
  unit_price: number;
  gross_value: number;
  discount: number;
  surcharge: number;
  allocation: number;
};

export function Servicos() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<ServiceRow | null>(null);
  const [detailSales, setDetailSales] = useState<DailySaleRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);

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
      .from("services")
      .select("id, code, name, is_active, created_at", { count: "exact" })
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .range(from, to);
    const term = debouncedSearch.trim();
    if (term) {
      q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
    }
    const { data, error, count: c } = await q;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as ServiceRow[]);
    setCount(c ?? 0);
  }, [companyId, page, debouncedSearch]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const openDetail = async (row: ServiceRow) => {
    setDetail(row);
    setDetailSales([]);
    if (!companyId) return;
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("service_daily_sales")
      .select(
        "id, sale_date, quantity, unit_price, gross_value, discount, surcharge, allocation",
      )
      .eq("company_id", companyId)
      .eq("service_id", row.id)
      .order("sale_date", { ascending: false })
      .limit(30);
    setDetailLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDetailSales((data ?? []) as DailySaleRow[]);
  };

  const createService = async () => {
    if (!companyId) return;
    const code = createCode.trim();
    const name = createName.trim();
    if (!code || !name) {
      toast.error("Informe código e nome.");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("services").insert({
      company_id: companyId,
      code,
      name,
      is_active: true,
    });
    setCreating(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Já existe um serviço com este código."
          : error.message,
      );
      return;
    }
    toast.success("Serviço criado.");
    setCreateOpen(false);
    setCreateCode("");
    setCreateName("");
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
      .from("services")
      .update({
        name,
        is_active: detail.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detail.id)
      .eq("company_id", companyId);
    setSavingDetail(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Serviço atualizado.");
    setDetail(null);
    void load();
  };

  return (
    <PageShell className="flex min-h-0 flex-1 flex-col gap-4 pb-0">
      <PageHeader
        title="Serviços"
        description={
          <span className="hidden sm:inline">
            Catálogo de serviços do PDV (sem estoque). Vendas diárias vêm da
            sincronização EPOC.
          </span>
        }
        icon={ConciergeBell}
        className="shrink-0"
        action={
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo serviço
          </Button>
        }
      />

      <div className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card/60 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-4">
        <Input
          placeholder="Filtrar por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 min-w-0 flex-1 sm:max-w-xs"
        />
      </div>

      <div className="flex max-h-[calc(100dvh-11rem)] min-h-[min(28rem,calc(100dvh-13rem))] flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="hidden shrink-0 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_6.5rem] md:gap-3">
          <span>Serviço</span>
          <span>Código</span>
          <span className="text-right pr-1">Status</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              Carregando...
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              {debouncedSearch.trim()
                ? "Nenhum serviço encontrado para este filtro."
                : "Nenhum serviço cadastrado."}
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => {
                const statusBadge = row.is_active
                  ? {
                      label: "Ativo",
                      className:
                        "border-emerald-600/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
                    }
                  : {
                      label: "Inativo",
                      className: "border-muted-foreground/30",
                    };
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openDetail(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openDetail(row);
                      }
                    }}
                    className={cn(
                      "group relative border-l-[3px] bg-card outline-none transition-colors",
                      "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      row.is_active
                        ? "border-l-emerald-600/80"
                        : "border-l-muted-foreground/35",
                    )}
                  >
                    <div className="hidden md:grid md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_6.5rem] md:items-center md:gap-3 md:px-4 md:py-2.5">
                      <p className="min-w-0 truncate text-sm font-semibold leading-tight tracking-tight">
                        {row.name}
                      </p>
                      <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {row.code}
                      </p>
                      <div className="flex justify-end pr-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-normal",
                            statusBadge.className,
                          )}
                        >
                          {statusBadge.label}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-3 px-3 py-3 md:hidden">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-snug">
                          {row.name}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {row.code}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px] font-normal",
                          statusBadge.className,
                        )}
                      >
                        {statusBadge.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && (
          <div className="shrink-0 border-t px-2 py-2 sm:px-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={count}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="flex flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Novo serviço</SheetTitle>
            <SheetDescription>
              O código deve coincidir com o do portal EPOC para evitar
              duplicidade na sync.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-code">Código</Label>
              <Input
                id="svc-code"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-name">Nome</Label>
              <Input
                id="svc-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
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
              onClick={() => void createService()}
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
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>Serviço</SheetTitle>
                <SheetDescription className="font-mono">
                  {detail.code}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="svc-edit-name">Nome</Label>
                  <Input
                    id="svc-edit-name"
                    value={detail.name}
                    onChange={(e) =>
                      setDetail({ ...detail, name: e.target.value })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <Label htmlFor="svc-active">Ativo</Label>
                  <Switch
                    id="svc-active"
                    checked={detail.is_active}
                    onCheckedChange={(v) =>
                      setDetail({ ...detail, is_active: v })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Vendas recentes (EPOC)</p>
                {detailLoading ? (
                  <p className="text-muted-foreground text-sm">A carregar…</p>
                ) : detailSales.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Sem vendas diárias sincronizadas.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-muted/40 border-b">
                          <th className="px-2 py-1.5 font-medium">Data</th>
                          <th className="px-2 py-1.5 font-medium">Qtde</th>
                          <th className="px-2 py-1.5 font-medium">Unit.</th>
                          <th className="px-2 py-1.5 font-medium">Bruto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailSales.map((s) => (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="px-2 py-1.5">
                              {formatIsoDateBr(s.sale_date)}
                            </td>
                            <td className="px-2 py-1.5 font-mono tabular-nums">
                              {formatNumberPtBr(Number(s.quantity), 0)}
                            </td>
                            <td className="px-2 py-1.5 font-mono tabular-nums">
                              {formatMoneyPtBr(Number(s.unit_price))}
                            </td>
                            <td className="px-2 py-1.5 font-mono tabular-nums">
                              {formatMoneyPtBr(Number(s.gross_value))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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

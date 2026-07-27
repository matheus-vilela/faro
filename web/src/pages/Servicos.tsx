import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <PageShell className="space-y-6">
      <PageHeader
        title="Serviços"
        description="Catálogo de serviços do PDV (sem estoque). Vendas diárias vêm da sincronização EPOC."
        icon={ConciergeBell}
        action={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Novo serviço
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar por nome ou código…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {loading ? (
            <p className="text-muted-foreground p-4 text-sm">A carregar…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              Nenhum serviço cadastrado.
            </p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => void openDetail(row)}
                className={cn(
                  "hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {row.code}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs",
                    row.is_active
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {row.is_active ? "Ativo" : "Inativo"}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={count}
        onPageChange={setPage}
      />

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

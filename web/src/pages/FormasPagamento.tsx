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
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { CreditCard, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type PaymentMethodRow = {
  id: string;
  sku: string;
  name: string;
  is_active: boolean;
  created_at: string;
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
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<PaymentMethodRow | null>(null);
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
      .from("payment_methods")
      .select("id, sku, name, is_active, created_at", { count: "exact" })
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
    setRows((data ?? []) as PaymentMethodRow[]);
    setCount(c ?? 0);
  }, [companyId, page, debouncedSearch]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

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
    <PageShell className="space-y-6">
      <PageHeader
        title="Formas de pagamento"
        description="Catálogo usado no faturamento EPOC. O SKU é o código antes do « - » no relatório; o nome pode ser ajustado aqui."
        icon={CreditCard}
        action={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Nova forma
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar por nome ou SKU…"
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
              Nenhuma forma de pagamento cadastrada. Elas surgem automaticamente
              ao sincronizar o faturamento EPOC, ou pode criar manualmente.
            </p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetail(row)}
                className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {row.sku}
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
                  {row.is_active ? "Ativa" : "Inativa"}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count}
        onPageChange={setPage}
      />

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

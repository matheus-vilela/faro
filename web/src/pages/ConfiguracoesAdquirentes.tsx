import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  acquirerSlugFromName,
  type CompanyAcquirer,
} from "@/types/acquirer";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

function mapAcquirerError(message: string): string {
  if (message.includes("acquirers_company_slug_uq")) {
    return "Já existe uma adquirente com este nome.";
  }
  return message;
}

export function ConfiguracoesAdquirentes() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [rows, setRows] = useState<CompanyAcquirer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyAcquirer | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("acquirers")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar adquirentes: " + error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as CompanyAcquirer[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setIsActive(true);
    setSheetOpen(true);
  };

  const openEdit = (row: CompanyAcquirer) => {
    setEditing(row);
    setName(row.name);
    setIsActive(row.is_active);
    setSheetOpen(true);
  };

  const save = async () => {
    if (!companyId) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Informe o nome da adquirente.");
      return;
    }
    const slug = acquirerSlugFromName(trimmedName);
    if (!slug) {
      toast.error("Use um nome com letras ou números.");
      return;
    }

    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("acquirers")
        .update({ name: trimmedName, slug, is_active: isActive })
        .eq("id", editing.id)
        .eq("company_id", companyId);
      setSaving(false);
      if (error) {
        toast.error(mapAcquirerError(error.message));
        return;
      }
      toast.success("Adquirente atualizada.");
    } else {
      const { error } = await supabase.from("acquirers").insert({
        company_id: companyId,
        name: trimmedName,
        slug,
        is_active: isActive,
      });
      setSaving(false);
      if (error) {
        toast.error(mapAcquirerError(error.message));
        return;
      }
      toast.success("Adquirente criada.");
    }
    setSheetOpen(false);
    void load();
  };

  const remove = async (row: CompanyAcquirer) => {
    if (!companyId) return;
    setDeletingId(row.id);
    const { error } = await supabase
      .from("acquirers")
      .delete()
      .eq("id", row.id)
      .eq("company_id", companyId);
    setDeletingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (editing?.id === row.id) {
      setSheetOpen(false);
      setEditing(null);
    }
    toast.success("Adquirente removida. Formas e contas ligadas ficam sem adquirente.");
    void load();
  };

  const busy = saving || deletingId !== null;

  return (
    <PageShell className="space-y-8 pb-0">
      <PageHeader
        title="Adquirentes"
        description="Cadastre Stone, Cielo, Rede e outras. Depois associe às formas de pagamento e às contas onde os recebíveis caem."
        icon={Building2}
      />

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Adquirentes cadastradas</CardTitle>
              <CardDescription>
                A correlação aparece no faturamento e no resumo de vendas.{" "}
                <Link
                  to="/app/configuracoes/formas-de-pagamento"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Formas de pagamento
                </Link>
                {" · "}
                <Link
                  to="/app/configuracoes/contas-bancarias"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Contas bancárias
                </Link>
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="w-full shrink-0 sm:w-auto"
              onClick={openCreate}
              disabled={busy}
            >
              <Plus className="mr-1 h-4 w-4" />
              Nova adquirente
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma adquirente cadastrada. Crie Stone, Cielo, Rede ou outra
              para correlacionar cartões e recebíveis.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <div
                className="grid min-w-[min(100%,32rem)] grid-cols-1 gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_5.5rem] md:items-center md:gap-3"
                role="row"
              >
                <span>Nome</span>
                <span>Estado</span>
                <span className="hidden text-center md:block">Ações</span>
              </div>
              <ul className="divide-y">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex min-w-[min(100%,32rem)] flex-col gap-2 px-4 py-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_5.5rem] md:items-center md:gap-3"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{row.name}</span>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.slug}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "w-fit rounded-full px-2 py-0.5 text-xs",
                        row.is_active
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.is_active ? "Ativa" : "Inativa"}
                    </span>
                    <div className="flex justify-end gap-1 md:justify-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(row)}
                        disabled={busy}
                        aria-label="Editar adquirente"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(row)}
                        disabled={busy}
                        aria-label={`Excluir ${row.name}`}
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => !busy && setSheetOpen(open)}
      >
        <SheetContent className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar adquirente" : "Nova adquirente"}
            </SheetTitle>
            <SheetDescription>
              Nome livre (Stone, Cielo, Rede, Getnet, PagSeguro, Mercado Pago…).
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="acquirer-name">Nome</Label>
              <Input
                id="acquirer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Stone"
                disabled={saving}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label htmlFor="acquirer-active">Ativa</Label>
              <Switch
                id="acquirer-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={saving}
              />
            </div>
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSheetOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

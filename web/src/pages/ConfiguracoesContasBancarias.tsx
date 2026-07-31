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
import { useCompany, useIsOwnerAccess } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  bankAccountTypeLabel,
  type BankAccountType,
  type CompanyBankAccount,
} from "@/types/bankAccount";
import { Landmark, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

function mapSupabaseError(message: string): string {
  if (message.includes("company_bank_accounts_company_name_unique")) {
    return "Já existe uma conta com este nome.";
  }
  return message;
}

export function ConfiguracoesContasBancarias() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const isOwner = useIsOwnerAccess();

  const [rows, setRows] = useState<CompanyBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyBankAccount | null>(null);
  const [name, setName] = useState("");
  const [tipo, setTipo] = useState<BankAccountType>("corrente");
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
      .from("company_bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar contas bancárias: " + error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as CompanyBankAccount[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setTipo("corrente");
    setSheetOpen(true);
  };

  const openEdit = (row: CompanyBankAccount) => {
    setEditing(row);
    setName(row.name);
    setTipo(row.tipo);
    setSheetOpen(true);
  };

  const save = async () => {
    if (!companyId || !isOwner) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Informe o nome da conta.");
      return;
    }

    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("company_bank_accounts")
        .update({ name: trimmedName, tipo })
        .eq("id", editing.id)
        .eq("company_id", companyId);
      setSaving(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Conta atualizada.");
    } else {
      const { error } = await supabase.from("company_bank_accounts").insert({
        company_id: companyId,
        name: trimmedName,
        tipo,
      });
      setSaving(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Conta criada.");
    }
    setSheetOpen(false);
    void load();
  };

  const remove = async (row: CompanyBankAccount) => {
    if (!companyId || !isOwner) return;
    setDeletingId(row.id);
    const { error } = await supabase
      .from("company_bank_accounts")
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
    toast.success("Conta removida.");
    void load();
  };

  const busy = saving || deletingId !== null;

  return (
    <PageShell className="space-y-8 pb-0">
      <PageHeader
        title="Contas bancárias"
        description="Cadastre as contas bancárias da empresa para uso em fluxos financeiros."
        icon={Landmark}
      />

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Contas cadastradas</CardTitle>
              <CardDescription>
                Cada conta tem um nome de identificação e um tipo (corrente,
                poupança ou outro).
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 w-full sm:w-auto"
              onClick={openCreate}
              disabled={!isOwner || busy}
            >
              <Plus className="h-4 w-4 mr-1" />
              Nova conta
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta bancária cadastrada.
            </p>
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <div
                className="grid min-w-[min(100%,32rem)] grid-cols-1 gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_5.5rem] md:items-center md:gap-3"
                role="row"
              >
                <span>Nome</span>
                <span>Tipo</span>
                <span className="hidden text-center md:block">Ações</span>
              </div>
              <ul className="divide-y">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex min-w-[min(100%,32rem)] flex-col gap-2 px-4 py-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_5.5rem] md:items-center md:gap-3"
                  >
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {bankAccountTypeLabel(row.tipo)}
                    </span>
                    <div className="flex justify-end gap-1 md:justify-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(row)}
                        disabled={!isOwner || busy}
                        aria-label="Editar conta"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(row)}
                        disabled={!isOwner || busy}
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
              {editing ? "Editar conta bancária" : "Nova conta bancária"}
            </SheetTitle>
            <SheetDescription>
              Informe o nome e o tipo da conta.
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bank-account-name">Nome</Label>
              <Input
                id="bank-account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Bradesco operacional"
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={tipo}
                onValueChange={(v) => setTipo(v as BankAccountType)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BANK_ACCOUNT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

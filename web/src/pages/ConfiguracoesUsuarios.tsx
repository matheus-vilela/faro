import { PermissionProfilesSection } from "@/components/configuracoes/PermissionProfilesSection";
import { PlatformAccessSection } from "@/components/configuracoes/PlatformAccessSection";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import {
  applyWhatsappPhoneMaskChange,
  formatNormalizedForDisplay,
  maskWhatsappBrInput,
  stripToDigits,
  validateAndNormalizePhone,
} from "@/lib/whatsappPhone";
import type { CompanyMember } from "@/types/companyMember";
import { cn } from "@/lib/utils";
import { Info, Loader2, Pencil, Plus, Shield, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

type UsuariosTab = "acessos" | "permissoes";

function mapSupabaseError(message: string): string {
  if (message.includes("Limite de 3")) {
    return "Limite de 3 operadores ativos por empresa.";
  }
  if (message.includes("proprietário")) {
    return "Este número já é o do proprietário ou conflita com ele.";
  }
  if (message.includes("23505")) {
    return "Já existe um operador ativo com este telefone.";
  }
  return message;
}

export function ConfiguracoesUsuarios() {
  const { currentCompany, isCompanyOwner, refetchCompanies } = useCompany();
  const companyId = currentCompany?.id;
  const isOwner = isCompanyOwner;
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab: UsuariosTab =
    isOwner && searchParams.get("aba") === "permissoes"
      ? "permissoes"
      : "acessos";

  const setActiveTab = (tab: UsuariosTab) => {
    if (tab === "acessos") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ aba: "permissoes" }, { replace: true });
    }
  };

  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);

  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<CompanyMember | null>(
    null,
  );
  const [memberName, setMemberName] = useState("");
  const [memberPhoneDigits, setMemberPhoneDigits] = useState("");
  /** Operador pode usar *estoque* / *inventario* no WhatsApp (além do proprietário). */
  const [memberCanInventoryCount, setMemberCanInventoryCount] =
    useState(false);
  /** Só no fluxo de edição: operador autorizado no webhook (limite 3 ativos). */
  const [memberIsActive, setMemberIsActive] = useState(true);

  const activeCount = useMemo(
    () => members.filter((m) => m.is_active).length,
    [members],
  );

  const loadMembers = useCallback(async () => {
    if (!companyId) return;
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("company_members")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar operadores: " + error.message);
      setMembers([]);
    } else {
      setMembers((data ?? []) as CompanyMember[]);
    }
    setLoadingMembers(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => loadMembers());
  }, [loadMembers]);

  const openAddMember = () => {
    if (activeCount >= 3) {
      toast.error(
        "Limite de 3 operadores ativos atingido. Desative um operador para adicionar outro.",
      );
      return;
    }
    setEditingMember(null);
    setMemberName("");
    setMemberPhoneDigits("");
    setMemberCanInventoryCount(false);
    setMemberIsActive(true);
    setMemberSheetOpen(true);
  };

  const openEditMember = (m: CompanyMember) => {
    setEditingMember(m);
    setMemberName(m.name);
    setMemberPhoneDigits(
      m.phone_normalized ?? stripToDigits(m.phone_display ?? ""),
    );
    setMemberCanInventoryCount(m.can_inventory_count ?? false);
    setMemberIsActive(m.is_active);
    setMemberSheetOpen(true);
  };

  const saveMember = async () => {
    if (!currentCompany?.id || !isOwner) return;
    const name = memberName.trim();
    if (!name) {
      toast.error("Informe o nome.");
      return;
    }
    const v = validateAndNormalizePhone(memberPhoneDigits);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }

    const displayStored = maskWhatsappBrInput(memberPhoneDigits).trim() || null;

    if (editingMember) {
      if (
        memberIsActive &&
        !editingMember.is_active &&
        activeCount >= 3
      ) {
        toast.error(
          "Limite de 3 operadores ativos. Desative outro operador primeiro.",
        );
        return;
      }
    }

    setSaving(true);
    if (editingMember) {
      const { error } = await supabase
        .from("company_members")
        .update({
          name,
          phone_normalized: v.normalized,
          phone_display: displayStored,
          is_active: memberIsActive,
          can_inventory_count: memberCanInventoryCount,
        })
        .eq("id", editingMember.id)
        .eq("company_id", currentCompany.id);

      setSaving(false);
      setMemberSheetOpen(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Operador atualizado.");
    } else {
      const { error } = await supabase.from("company_members").insert({
        company_id: currentCompany.id,
        name,
        phone_normalized: v.normalized,
        phone_display: displayStored,
        is_active: true,
        can_inventory_count: memberCanInventoryCount,
      });
      setSaving(false);
      setMemberSheetOpen(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Operador adicionado.");
    }
    await loadMembers();
    await refetchCompanies();
  };

  const toggleMemberActive = async (m: CompanyMember, active: boolean) => {
    if (!currentCompany?.id || !isOwner) return;
    if (active && activeCount >= 3 && !m.is_active) {
      toast.error(
        "Limite de 3 operadores ativos. Desative outro operador primeiro.",
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("company_members")
      .update({ is_active: active })
      .eq("id", m.id)
      .eq("company_id", currentCompany.id);
    setSaving(false);
    if (error) {
      toast.error(mapSupabaseError(error.message));
      return;
    }
    toast.success(active ? "Operador ativado." : "Operador desativado.");
    await loadMembers();
  };

  const toggleMemberInventoryCount = async (
    m: CompanyMember,
    allowed: boolean,
  ) => {
    if (!currentCompany?.id || !isOwner) return;
    setSaving(true);
    const { error } = await supabase
      .from("company_members")
      .update({ can_inventory_count: allowed })
      .eq("id", m.id)
      .eq("company_id", currentCompany.id);
    setSaving(false);
    if (error) {
      toast.error(mapSupabaseError(error.message));
      return;
    }
    toast.success(
      allowed
        ? "Operador pode solicitar contagem de estoque pelo WhatsApp."
        : "Permissão de contagem de estoque removida.",
    );
    await loadMembers();
  };

  return (
    <PageShell className="space-y-8 pb-0">
      <PageHeader
        title="Usuários e acessos"
        description="Proprietário, colaboradores com login no Faro e operadores que interagem pelo WhatsApp (sem login na plataforma)."
        icon={Users}
      />

      {isOwner ? (
        <nav
          className="flex flex-wrap gap-2 border-b border-border pb-px"
          aria-label="Seções de usuários e acessos"
        >
          <button
            type="button"
            onClick={() => setActiveTab("acessos")}
            className={cn(
              "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === "acessos"
                ? "border-border bg-background text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            Acessos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("permissoes")}
            className={cn(
              "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === "permissoes"
                ? "border-border bg-background text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            Permissões
          </button>
        </nav>
      ) : null}

      {activeTab === "permissoes" && isOwner ? (
        <PermissionProfilesSection />
      ) : (
        <>
      {isOwner ? <PlatformAccessSection /> : null}

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">
                Operadores (somente WhatsApp)
              </CardTitle>
              <CardDescription className="max-w-xl">
                Operadores <strong>não recebem acesso</strong> ao sistema Faro (sem
                login). Eles aparecem aqui para autorizar o{" "}
                <strong>número de WhatsApp</strong> e, se você permitir, o
                comando de <strong>contagem de estoque</strong> (*estoque* /
                *inventario*).
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 w-full sm:w-auto"
              onClick={openAddMember}
              disabled={saving || activeCount >= 3}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar operador
            </Button>
          </div>
          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10">
            <Info className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              Ao adicionar um operador, informe o{" "}
              <strong>número do WhatsApp</strong> (com DDD).
              <br />
              Esse número será validado nas mensagens recebidas
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum operador cadastrado.
            </p>
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <div
                className="grid min-w-[min(100%,52rem)] grid-cols-1 gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_5rem_5rem_2.75rem] md:items-center md:gap-3"
                role="row"
              >
                <span>Nome</span>
                <span>WhatsApp</span>
                <span
                  className="hidden text-center md:block"
                  title="Contagem de estoque pelo WhatsApp"
                >
                  Estoque
                </span>
                <span className="hidden text-center md:block">Ativo</span>
                <span className="hidden text-center md:block">Ações</span>
              </div>
              <ul className="divide-y">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex min-w-[min(100%,52rem)] flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_5rem_5rem_2.75rem] md:items-center md:gap-3"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground text-sm font-mono">
                      {m.phone_display?.trim()
                        ? m.phone_display
                        : formatNormalizedForDisplay(m.phone_normalized)}
                    </span>
                    <div className="flex items-center justify-between gap-2 md:justify-center">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Estoque
                      </span>
                      <Switch
                        checked={m.can_inventory_count ?? false}
                        onCheckedChange={(checked) =>
                          toggleMemberInventoryCount(m, checked)
                        }
                        disabled={saving}
                        aria-label="Permitir contagem de estoque pelo WhatsApp"
                        className="shrink-0"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 md:justify-center">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Ativo
                      </span>
                      <Switch
                        checked={m.is_active}
                        onCheckedChange={(checked) =>
                          toggleMemberActive(m, checked)
                        }
                        disabled={saving}
                        className="shrink-0"
                      />
                    </div>
                    <div className="flex justify-end md:justify-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditMember(m)}
                            aria-label="Editar operador"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Editar</TooltipContent>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Operadores ativos autorizados no webhook: {activeCount} / 3
          </p>
        </CardContent>
      </Card>

      <Sheet open={memberSheetOpen} onOpenChange={setMemberSheetOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editingMember ? "Editar operador" : "Novo operador"}
            </SheetTitle>
            <SheetDescription>
              Cadastre o <strong>nome</strong> e o{" "}
              <strong>número de WhatsApp</strong> (celular com WhatsApp ativo).
              Este operador <strong>não terá login</strong> no Faro — apenas este
              número poderá enviar mensagens autorizadas pela integração.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="mName">Nome</Label>
              <Input
                id="mName"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Nome para identificação"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mPhone">WhatsApp (celular)</Label>
              <p className="text-xs text-muted-foreground">
                Precisa ser o número com WhatsApp; será normalizado ao salvar.
              </p>
              <Input
                id="mPhone"
                type="tel"
                inputMode="tel"
                className="font-mono"
                placeholder="+55 (11) 91234-5678"
                value={maskWhatsappBrInput(memberPhoneDigits)}
                onChange={(e) =>
                  setMemberPhoneDigits(
                    applyWhatsappPhoneMaskChange(
                      memberPhoneDigits,
                      e.target.value,
                    ),
                  )
                }
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/80 bg-muted/30 px-4 py-3">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="mInvCount" className="text-sm font-medium">
                  Contagem de estoque (WhatsApp)
                </Label>
                <p className="text-xs text-muted-foreground leading-snug">
                  Se ativo, este operador pode enviar <strong>*estoque*</strong> ou{" "}
                  <strong>*inventario*</strong> para receber o link de contagem.
                  O proprietário sempre pode.
                </p>
              </div>
              <Switch
                id="mInvCount"
                checked={memberCanInventoryCount}
                onCheckedChange={setMemberCanInventoryCount}
                disabled={saving}
                className="shrink-0 mt-0.5"
              />
            </div>
            {editingMember ? (
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/80 bg-muted/30 px-4 py-3">
                <div className="space-y-1 min-w-0">
                  <Label htmlFor="mActive" className="text-sm font-medium">
                    Operador ativo
                  </Label>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Operadores inativos não são autorizados no webhook. Limite de{" "}
                    <strong>3 operadores ativos</strong> por empresa.
                  </p>
                </div>
                <Switch
                  id="mActive"
                  checked={memberIsActive}
                  onCheckedChange={setMemberIsActive}
                  disabled={saving}
                  className="shrink-0 mt-0.5"
                />
              </div>
            ) : null}
          </div>
          <SheetFooter className="mt-auto border-t pt-4">
            <Button
              className="w-full sm:w-auto"
              onClick={saveMember}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar operador"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
        </>
      )}
    </PageShell>
  );
}

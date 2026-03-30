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
import { canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import {
  applyWhatsappPhoneMaskChange,
  formatNormalizedForDisplay,
  maskWhatsappBrInput,
  stripToDigits,
  validateAndNormalizePhone,
} from "@/lib/whatsappPhone";
import type { CompanyMember } from "@/types/companyMember";
import { Info, Loader2, Pencil, Plus, UserCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function mapSupabaseError(message: string): string {
  if (message.includes("Limite de 3")) {
    return "Limite de 3 membros ativos por empresa.";
  }
  if (message.includes("proprietário")) {
    return "Este número já é o do proprietário ou conflita com ele.";
  }
  if (message.includes("23505")) {
    return "Já existe um membro ativo com este telefone.";
  }
  return message;
}

export function ConfiguracoesUsuariosMembros() {
  const { currentCompany, currentRole, refetchCompanies } = useCompany();
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false;

  const [ownerNameDisplay, setOwnerNameDisplay] = useState("");
  const [loadingOwner, setLoadingOwner] = useState(true);

  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);

  const [ownerPhoneDigits, setOwnerPhoneDigits] = useState("");

  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<CompanyMember | null>(
    null,
  );
  const [memberName, setMemberName] = useState("");
  const [memberPhoneDigits, setMemberPhoneDigits] = useState("");

  const activeCount = useMemo(
    () => members.filter((m) => m.is_active).length,
    [members],
  );

  const loadOwner = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoadingOwner(true);
    const { data: uc, error: ucErr } = await supabase
      .from("user_companies")
      .select("user_id")
      .eq("company_id", currentCompany.id)
      .eq("role", "owner")
      .maybeSingle();

    if (ucErr || !uc?.user_id) {
      setOwnerNameDisplay("");
      setLoadingOwner(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", uc.user_id)
      .maybeSingle();

    setOwnerNameDisplay(profile?.full_name?.trim() ?? "");
    setLoadingOwner(false);
  }, [currentCompany?.id]);

  const loadMembers = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("company_members")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar membros: " + error.message);
      setMembers([]);
    } else {
      setMembers((data ?? []) as CompanyMember[]);
    }
    setLoadingMembers(false);
  }, [currentCompany?.id]);

  useEffect(() => {
    loadOwner();
  }, [loadOwner]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!currentCompany) return;
    const ownerNorm = currentCompany.owner_whatsapp_normalized;
    setOwnerPhoneDigits(ownerNorm ?? "");
  }, [currentCompany]);

  const saveOwnerPhone = async () => {
    if (!currentCompany?.id || !isOwner) return;
    if (!ownerPhoneDigits.trim()) {
      setSaving(true);
      const { error } = await supabase
        .from("companies")
        .update({
          owner_whatsapp_normalized: null,
          owner_whatsapp_display: null,
        })
        .eq("id", currentCompany.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("WhatsApp do proprietário removido.");
      setOwnerPhoneDigits("");
      await refetchCompanies();
      return;
    }

    const v = validateAndNormalizePhone(ownerPhoneDigits);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }
    setSaving(true);

    const { error } = await supabase
      .from("companies")
      .update({
        owner_whatsapp_normalized: v.normalized,
        owner_whatsapp_display: null,
      })
      .eq("id", currentCompany.id);

    setSaving(false);
    if (error) {
      toast.error(mapSupabaseError(error.message));
      return;
    }
    toast.success("Número salvo com DDI 55 e formato internacional.");
    await refetchCompanies();
    setOwnerPhoneDigits(v.normalized);
  };

  const clearOwnerPhone = async () => {
    if (!currentCompany?.id || !isOwner) return;
    setSaving(true);
    const { error } = await supabase
      .from("companies")
      .update({
        owner_whatsapp_normalized: null,
        owner_whatsapp_display: null,
      })
      .eq("id", currentCompany.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("WhatsApp do proprietário removido.");
    setOwnerPhoneDigits("");
    await refetchCompanies();
  };

  const openAddMember = () => {
    if (activeCount >= 3) {
      toast.error(
        "Limite de 3 membros ativos atingido. Desative um membro para adicionar outro.",
      );
      return;
    }
    setEditingMember(null);
    setMemberName("");
    setMemberPhoneDigits("");
    setMemberSheetOpen(true);
  };

  const openEditMember = (m: CompanyMember) => {
    setEditingMember(m);
    setMemberName(m.name);
    setMemberPhoneDigits(
      m.phone_normalized ?? stripToDigits(m.phone_display ?? ""),
    );
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

    setSaving(true);
    if (editingMember) {
      const { error } = await supabase
        .from("company_members")
        .update({
          name,
          phone_normalized: v.normalized,
          phone_display: displayStored,
        })
        .eq("id", editingMember.id)
        .eq("company_id", currentCompany.id);

      setSaving(false);
      setMemberSheetOpen(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Membro atualizado.");
    } else {
      const { error } = await supabase.from("company_members").insert({
        company_id: currentCompany.id,
        name,
        phone_normalized: v.normalized,
        phone_display: displayStored,
        is_active: true,
      });
      setSaving(false);
      setMemberSheetOpen(false);
      if (error) {
        toast.error(mapSupabaseError(error.message));
        return;
      }
      toast.success("Membro adicionado.");
    }
    await loadMembers();
    await refetchCompanies();
  };

  const toggleMemberActive = async (m: CompanyMember, active: boolean) => {
    if (!currentCompany?.id || !isOwner) return;
    if (active && activeCount >= 3 && !m.is_active) {
      toast.error(
        "Limite de 3 membros ativos. Desative outro membro primeiro.",
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
    toast.success(active ? "Membro ativado." : "Membro desativado.");
    await loadMembers();
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Usuários e membros
        </h2>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Dados do proprietário com acesso ao sistema e membros que interagem
          apenas pelo WhatsApp (sem login no Faro).
        </p>
      </div>

      <Card className="shadow-sm border-primary/15">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCircle className="h-5 w-5 text-primary" />
            Proprietário
          </CardTitle>
          <CardDescription>
            Você é o proprietário desta empresa no Faro. O WhatsApp abaixo é o
            principal para validação das mensagens recebidas (o mesmo número da
            linha da plataforma é usado por todas as empresas; identificamos
            você pelo seu WhatsApp).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-8 sm:items-start">
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                Nome do proprietário
              </Label>
              <div
                className="flex min-h-11 items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium leading-snug"
                aria-live="polite"
              >
                {loadingOwner ? (
                  <span className="text-muted-foreground">Carregando…</span>
                ) : ownerNameDisplay ? (
                  ownerNameDisplay
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Igual ao nome do seu perfil no Faro. Para alterar, use os dados
                da sua conta.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownerPhone">WhatsApp do proprietário</Label>
              <Input
                id="ownerPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+55 (11) 98765-4321"
                className="font-mono text-base"
                value={maskWhatsappBrInput(ownerPhoneDigits)}
                onChange={(e) =>
                  setOwnerPhoneDigits(
                    applyWhatsappPhoneMaskChange(
                      ownerPhoneDigits,
                      e.target.value,
                    ),
                  )
                }
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                Digite com DDD. Ao salvar, o número é normalizado; se você não
                informar o código do país, <strong>55</strong> (Brasil) é
                adicionado automaticamente.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={saveOwnerPhone} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar telefone"
              )}
            </Button>
            {ownerPhoneDigits.trim() ||
            currentCompany?.owner_whatsapp_normalized ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={clearOwnerPhone}
              >
                Remover telefone
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">
                Membros (somente WhatsApp)
              </CardTitle>
              <CardDescription className="max-w-xl">
                Membros <strong>não recebem acesso</strong> ao sistema Faro (sem
                login). Eles aparecem aqui apenas para autorizar o{" "}
                <strong>número de WhatsApp</strong> que poderá enviar mensagens
                pela integração — conforme o cadastro abaixo.
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 w-full sm:w-auto"
              onClick={openAddMember}
              disabled={saving || activeCount >= 3}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar membro
            </Button>
          </div>
          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10">
            <Info className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              Ao adicionar um membro, informe o{" "}
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
              Nenhum membro cadastrado.
            </p>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="grid grid-cols-1 gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid-cols-[1fr_1fr_auto_auto]">
                <span>Nome</span>
                <span>WhatsApp</span>
                <span className="hidden sm:block text-center">Ativo</span>
                <span className="hidden sm:block sr-only">Ações</span>
              </div>
              <ul className="divide-y">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:grid sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center sm:gap-2"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground text-sm font-mono">
                      {m.phone_display?.trim()
                        ? m.phone_display
                        : formatNormalizedForDisplay(m.phone_normalized)}
                    </span>
                    <div className="flex items-center justify-between gap-2 sm:justify-center">
                      <span className="text-xs text-muted-foreground sm:hidden">
                        Ativo
                      </span>
                      <Switch
                        checked={m.is_active}
                        onCheckedChange={(checked) =>
                          toggleMemberActive(m, checked)
                        }
                        disabled={saving}
                      />
                    </div>
                    <div className="flex justify-end sm:justify-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditMember(m)}
                        aria-label="Editar membro"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Membros ativos autorizados no webhook: {activeCount} / 3
          </p>
        </CardContent>
      </Card>

      <Sheet open={memberSheetOpen} onOpenChange={setMemberSheetOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editingMember ? "Editar membro" : "Novo membro"}
            </SheetTitle>
            <SheetDescription>
              Cadastre o <strong>nome</strong> e o{" "}
              <strong>número de WhatsApp</strong> (celular com WhatsApp ativo).
              Este membro <strong>não terá login</strong> no Faro — apenas este
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
                "Salvar membro"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

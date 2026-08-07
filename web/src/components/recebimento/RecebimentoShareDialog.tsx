import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import {
  applyWhatsappPhoneMaskChange,
  maskWhatsappBrInput,
  validateAndNormalizePhone,
} from "@/lib/whatsappPhone";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type CompanyMemberRow = { id: string; name: string };

const ADD_MEMBER_SELECT_VALUE = "__add_member__";

function mapCompanyMemberError(message: string): string {
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

export type RecebimentoShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recebimentoId: string | null;
  initialMemberId?: string | null;
  onShared?: () => void;
};

export function RecebimentoShareDialog({
  open,
  onOpenChange,
  recebimentoId,
  initialMemberId,
  onShared,
}: RecebimentoShareDialogProps) {
  const { currentCompany, isCompanyOwner } = useCompany();
  const [members, setMembers] = useState<CompanyMemberRow[]>([]);
  const [memberId, setMemberId] = useState("");
  const [saving, setSaving] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhoneDigits, setNewPhoneDigits] = useState("");
  const [creatingMember, setCreatingMember] = useState(false);

  useEffect(() => {
    if (!open || !currentCompany?.id) return;
    void (async () => {
      const { data } = await supabase
        .from("company_members")
        .select("id, name")
        .eq("company_id", currentCompany.id)
        .eq("is_active", true)
        .order("name", { ascending: true });
      setMembers((data as CompanyMemberRow[]) ?? []);
      setMemberId(initialMemberId ?? "");
    })();
  }, [open, currentCompany?.id, initialMemberId]);

  const copyShareLink = async (memberIdOverride?: string) => {
    if (!recebimentoId || !currentCompany?.id) return;
    const mid = memberIdOverride ?? memberId;
    if (!mid) {
      toast.error("Selecione o operador de referência para este recebimento.");
      return;
    }
    setSaving(true);
    const { data: res, error } = await supabase.rpc(
      "set_recebimento_assigned_member",
      {
        p_recebimento_id: recebimentoId,
        p_company_member_id: mid,
      },
    );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const out = res as { success?: boolean; error?: string };
    if (!out?.success) {
      toast.error(
        out?.error === "Sem permissão"
          ? "Apenas o proprietário pode vincular o operador."
          : (out?.error ?? "Não foi possível salvar o vínculo."),
      );
      return;
    }
    const { data: shortSlug, error: slugErr } = await supabase.rpc(
      "ensure_recebimento_short_slug",
      { p_recebimento_id: recebimentoId },
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
    toast.success(
      "Link copiado. Qualquer pessoa com o link pode confirmar; o operador é só referência.",
    );
    onOpenChange(false);
    onShared?.();
  };

  const handleCreateMember = async () => {
    if (!currentCompany?.id || !isCompanyOwner) return;
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome do operador.");
      return;
    }
    const phone = validateAndNormalizePhone(newPhoneDigits);
    if (!phone.ok) {
      toast.error(phone.error);
      return;
    }
    setCreatingMember(true);
    const { data: created, error } = await supabase
      .from("company_members")
      .insert({
        company_id: currentCompany.id,
        name,
        phone_normalized: phone.normalized,
        phone_display: maskWhatsappBrInput(newPhoneDigits).trim() || null,
        is_active: true,
        can_inventory_count: false,
      })
      .select("id, name")
      .single();
    setCreatingMember(false);
    if (error) {
      toast.error(mapCompanyMemberError(error.message));
      return;
    }
    toast.success("Operador cadastrado.");
    setAddMemberOpen(false);
    setNewName("");
    setNewPhoneDigits("");
    setMembers((prev) => [...prev, created as CompanyMemberRow]);
    setMemberId(created.id);
    await copyShareLink(created.id);
  };

  if (!isCompanyOwner) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular operador</DialogTitle>
            <DialogDescription>
              Apenas o proprietário pode vincular o operador e copiar o link de
              confirmação.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular operador</DialogTitle>
            <DialogDescription>
              Escolha o operador de referência e copie o link. Qualquer pessoa
              com o link pode confirmar o recebimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Operador</Label>
              <Select
                value={memberId || undefined}
                onValueChange={(v) => {
                  if (v === ADD_MEMBER_SELECT_VALUE) {
                    setAddMemberOpen(true);
                    return;
                  }
                  setMemberId(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o operador" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={ADD_MEMBER_SELECT_VALUE}>
                    + Cadastrar operador
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || !memberId}
              onClick={() => void copyShareLink()}
            >
              {saving ? "Gerando…" : "Copiar link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Novo operador</SheetTitle>
            <SheetDescription>
              Cadastro usado como referência no link de recebimento (máx. 3).
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-op-name">Nome</Label>
              <Input
                id="new-op-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-op-phone">WhatsApp</Label>
              <Input
                id="new-op-phone"
                inputMode="tel"
                value={maskWhatsappBrInput(newPhoneDigits)}
                onChange={(e) =>
                  setNewPhoneDigits(applyWhatsappPhoneMaskChange(e.target.value))
                }
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddMemberOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={creatingMember}
              onClick={() => void handleCreateMember()}
            >
              {creatingMember ? "Salvando…" : "Salvar e copiar link"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

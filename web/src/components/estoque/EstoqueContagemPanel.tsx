import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { EstoqueHistoricoContagem } from "@/components/estoque/EstoqueHistoricoContagem";
import { randomShortSlug } from "@/lib/randomSlug";
import { supabase } from "@/lib/supabase";
import type { CompanyMember } from "@/types/companyMember";
import type { InventoryCountGroup } from "@/types/inventoryCount";
import { ClipboardList, Copy, FolderPlus, Loader2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function EstoqueContagemPanel({ companyId }: { companyId: string }) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const [groups, setGroups] = useState<InventoryCountGroup[]>([]);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [groupId, setGroupId] = useState<string>("");
  const [assignedMemberId, setAssignedMemberId] = useState<string>("");

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  const loadGroupsAndMembers = useCallback(async () => {
    setLoadingMeta(true);
    const [gr, mem] = await Promise.all([
      supabase
        .from("inventory_count_groups")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("company_members")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);
    if (gr.error) console.error(gr.error);
    if (mem.error) console.error(mem.error);
    setGroups((gr.data ?? []) as InventoryCountGroup[]);
    setMembers((mem.data ?? []) as CompanyMember[]);
    setLoadingMeta(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void loadGroupsAndMembers());
  }, [loadGroupsAndMembers]);

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error("Informe o nome do grupo.");
      return;
    }
    setSavingGroup(true);
    const { data, error } = await supabase
      .from("inventory_count_groups")
      .insert({
        company_id: companyId,
        name,
        sort_order: groups.length,
      })
      .select("id")
      .single();
    setSavingGroup(false);
    if (error) {
      console.error(error);
      toast.error(error.message ?? "Não foi possível criar o grupo.");
      return;
    }
    toast.success("Grupo criado.");
    setNewGroupName("");
    setGroupDialogOpen(false);
    await loadGroupsAndMembers();
    if (data?.id) setGroupId(data.id as string);
  };

  const createLink = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;

    const { data: sess, error: se } = await supabase
      .from("inventory_count_sessions")
      .insert({
        company_id: companyId,
        status: "open",
        created_by_user_id: uid,
        inventory_count_group_id: groupId || null,
        assigned_company_member_id: assignedMemberId || null,
      })
      .select("id, token")
      .single();

    if (se || !sess?.id || !sess?.token) {
      console.error(se);
      toast.error("Não foi possível criar a sessão de contagem.");
      setLoading(false);
      return;
    }

    let slug: string | null = null;
    for (let i = 0; i < 15; i++) {
      const s = randomShortSlug(8);
      const { error: le } = await supabase
        .from("inventory_count_short_links")
        .insert({
          slug: s,
          session_id: sess.id,
          token: sess.token,
        });
      if (!le) {
        slug = s;
        break;
      }
      const code = (le as { code?: string }).code;
      if (code !== "23505") {
        console.error(le);
        break;
      }
    }

    const base = window.location.origin.replace(/\/$/, "");
    const url = slug
      ? `${base}/i/${slug}`
      : `${base}/contagem-estoque/${sess.token}`;

    setLink(url);
    setLoading(false);
    setHistoryTick((t) => t + 1);
    toast.success(
      "Link gerado. Envie ao operador ou abra no celular para contar o estoque.",
    );
  }, [companyId, groupId, assignedMemberId]);

  const copy = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link);
    toast.success("Link copiado.");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderPlus className="h-4 w-4" />
                Grupos de contagem
              </CardTitle>
              <CardDescription>
                Cadastre rótulos para organizar contagens por setor, depósito ou
                campanha. Os grupos aparecem no histórico e na tela pública do
                link.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setGroupDialogOpen(true)}
            >
              Novo grupo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingMeta ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum grupo ainda. Crie um acima para poder associá-lo ao gerar
              um link.
            </p>
          ) : (
            <ul className="text-sm space-y-1.5 list-disc list-inside text-muted-foreground">
              {groups.map((g) => (
                <li key={g.id}>
                  <span className="text-foreground font-medium">{g.name}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Novo link de contagem
          </CardTitle>
          <CardDescription>
            Escolha grupo e operador (opcionais) e gere o link para conferência
            física: o conferente informa o saldo por item e o sistema ajusta o
            estoque. Sessões com operador aparecem como{" "}
            <span className="font-medium text-foreground">pendentes</span> no
            histórico
            até o envio. No WhatsApp,{" "}
            <span className="font-medium text-foreground">*estoque*</span> ou{" "}
            <span className="font-medium text-foreground">*inventario*</span>{" "}
            listam links pendentes no seu nome; use{" "}
            <span className="font-medium text-foreground">*nova*</span> ou{" "}
            <span className="font-medium text-foreground">*nova contagem*</span>{" "}
            para gerar outro link (membros precisam da permissão em
            Configurações → Usuários e membros).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Grupo (opcional)</Label>
              <Select
                value={groupId || "__none__"}
                onValueChange={(v) =>
                  setGroupId(v === "__none__" ? "" : v)
                }
                disabled={loadingMeta}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum grupo</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Operador designado (opcional)
              </Label>
              <Select
                value={assignedMemberId || "__none__"}
                onValueChange={(v) =>
                  setAssignedMemberId(v === "__none__" ? "" : v)
                }
                disabled={loadingMeta}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Qualquer pessoa com o link" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    Qualquer pessoa com o link
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Membros ativos em Configurações → Usuários e membros. O nome
                aparece na tela do link para o conferente.
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => void createLink()}
            disabled={loading || loadingMeta}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando…
              </>
            ) : (
              "Gerar novo link de contagem"
            )}
          </Button>
          {link && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input readOnly value={link} className="font-mono text-sm" />
              <Button type="button" variant="outline" onClick={copy}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo grupo de contagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-group-name">Nome</Label>
            <Input
              id="new-group-name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Ex.: Cozinha, Depósito A, Inventário março"
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGroupDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void createGroup()}
              disabled={savingGroup}
            >
              {savingGroup ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Criar grupo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EstoqueHistoricoContagem
        companyId={companyId}
        refreshTrigger={historyTick}
      />
    </div>
  );
}

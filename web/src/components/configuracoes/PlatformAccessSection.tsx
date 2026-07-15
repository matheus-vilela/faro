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
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  addPlatformAccessByEmail,
  fetchCompanyPermissionProfiles,
  fetchCompanyPlatformAccess,
  revokePlatformAccess,
} from "@/services/companyAccessService";
import type {
  CompanyPermissionProfile,
  CompanyPlatformAccess,
} from "@/types/companyPermissions";
import { Loader2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/** Listagem e cadastro de acessos à plataforma. Visível só para o proprietário. */
export function PlatformAccessSection() {
  const { user } = useAuth();
  const { currentCompany, isCompanyOwner } = useCompany();
  const companyId = currentCompany?.id;

  const [profiles, setProfiles] = useState<CompanyPermissionProfile[]>([]);
  const [accessList, setAccessList] = useState<CompanyPlatformAccess[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteProfileId, setInviteProfileId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !isCompanyOwner) return;
    setLoading(true);
    const [pRes, aRes] = await Promise.all([
      fetchCompanyPermissionProfiles(companyId),
      fetchCompanyPlatformAccess(companyId),
    ]);
    if (pRes.error) toast.error(pRes.error);
    if (aRes.error) toast.error(aRes.error);
    setProfiles(pRes.profiles);
    setAccessList(aRes.access);
    const defaultProfile = pRes.profiles.find(
      (p) => p.is_system && p.name === "Membro",
    );
    if (defaultProfile) setInviteProfileId((prev) => prev || defaultProfile.id);
    setLoading(false);
  }, [companyId, isCompanyOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isCompanyOwner) return null;

  const openInviteDialog = () => {
    setInviteEmail("");
    setInviteDialogOpen(true);
  };

  const handleInvite = async () => {
    if (!companyId || !user?.id || !inviteProfileId) return;
    setInviting(true);
    const res = await addPlatformAccessByEmail({
      companyId,
      email: inviteEmail,
      permissionProfileId: inviteProfileId,
      invitedBy: user.id,
    });
    setInviting(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success(
        "E-mail cadastrado. O usuário verá a empresa ao se registrar.",
      );
      setInviteEmail("");
      setInviteDialogOpen(false);
      await load();
    }
  };

  const handleRevoke = async (accessId: string) => {
    const res = await revokePlatformAccess(accessId);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Acesso revogado.");
      await load();
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Acessos à plataforma</CardTitle>
            <CardDescription>
              Cadastre e-mails de colaboradores com login no Faro. Ao se
              registrar, a empresa aparece automaticamente no seletor de
              unidades.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0 w-full sm:w-auto"
            onClick={openInviteDialog}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Adicionar acesso
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : accessList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum e-mail cadastrado ainda. Clique em{" "}
              <strong>Adicionar acesso</strong> para convidar um colaborador.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {accessList.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{a.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.company_permission_profiles?.name ?? "Perfil"} ·{" "}
                      {a.status === "pending"
                        ? "Aguardando registro"
                        : "Ativo"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void handleRevoke(a.id)}
                  >
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar acesso</DialogTitle>
            <DialogDescription>
              O usuário não precisa existir ainda. Ao se registrar com este
              e-mail, a empresa aparecerá no seletor de unidades.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="access-email">E-mail</Label>
              <Input
                id="access-email"
                type="email"
                placeholder="colaborador@empresa.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="access-profile">Perfil</Label>
              <Select value={inviteProfileId} onValueChange={setInviteProfileId}>
                <SelectTrigger id="access-profile">
                  <SelectValue placeholder="Perfil" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.is_system ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInviteDialogOpen(false)}
              disabled={inviting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={inviting || !inviteEmail.trim() || !inviteProfileId}
              onClick={() => void handleInvite()}
            >
              {inviting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cadastrando...
                </>
              ) : (
                "Cadastrar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

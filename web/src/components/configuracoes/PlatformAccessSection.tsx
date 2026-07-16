import { Badge } from "@/components/ui/badge";
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
  fetchCompanyPlatformOwner,
  revokePlatformAccess,
  updateCollaboratorPermissionProfile,
  type CompanyPlatformOwner,
} from "@/services/companyAccessService";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  CompanyPermissionProfile,
  CompanyPlatformAccess,
} from "@/types/companyPermissions";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const TABLE_GRID =
  "min-w-[min(100%,56rem)] grid-cols-1 md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,11rem)_5.5rem_2.75rem] md:items-center md:gap-4";

function TableField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground md:sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}

function AccessStatusBadge({
  status,
}: {
  status: "active" | "pending" | "owner";
}) {
  if (status === "owner") {
    return (
      <Badge variant="secondary" className="whitespace-nowrap font-normal">
        Ativo
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="whitespace-nowrap border-amber-500/40 bg-amber-500/5 font-normal text-amber-950 dark:text-amber-100"
      >
        Pendente
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="whitespace-nowrap font-normal">
      Ativo
    </Badge>
  );
}

/** Usuários com login na plataforma: proprietário + colaboradores. */
export function PlatformAccessSection() {
  const { user } = useAuth();
  const { currentCompany, isCompanyOwner } = useCompany();
  const companyId = currentCompany?.id;

  const [owner, setOwner] = useState<CompanyPlatformOwner | null>(null);
  const [profiles, setProfiles] = useState<CompanyPermissionProfile[]>([]);
  const [accessList, setAccessList] = useState<CompanyPlatformAccess[]>([]);
  const [memberNamesByUserId, setMemberNamesByUserId] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [updatingAccessId, setUpdatingAccessId] = useState<string | null>(
    null,
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteProfileId, setInviteProfileId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const ownerEmail = useMemo(() => {
    if (owner?.user_id && user?.id === owner.user_id) {
      return user.email ?? null;
    }
    return owner?.email ?? null;
  }, [owner, user]);

  const ownerDisplayName = useMemo(() => {
    if (owner?.full_name) return owner.full_name;
    if (ownerEmail) return ownerEmail.split("@")[0] ?? "Proprietário";
    return "Proprietário";
  }, [owner, ownerEmail]);

  const load = useCallback(async () => {
    if (!companyId || !isCompanyOwner) return;
    setLoading(true);
    const [ownerRes, pRes, aRes] = await Promise.all([
      fetchCompanyPlatformOwner(companyId),
      fetchCompanyPermissionProfiles(companyId),
      fetchCompanyPlatformAccess(companyId),
    ]);
    if (ownerRes.error) toast.error(ownerRes.error);
    if (pRes.error) toast.error(pRes.error);
    if (aRes.error) toast.error(aRes.error);
    setOwner(ownerRes.owner);
    setProfiles(pRes.profiles);
    setAccessList(aRes.access);

    const userIds = aRes.access
      .map((a) => a.user_id)
      .filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const names: Record<string, string> = {};
      for (const row of profileRows ?? []) {
        const name = String(row.full_name ?? "").trim();
        if (name) names[String(row.id)] = name;
      }
      setMemberNamesByUserId(names);
    } else {
      setMemberNamesByUserId({});
    }

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

  const handleProfileChange = async (
    access: CompanyPlatformAccess,
    profileId: string,
  ) => {
    if (!companyId || profileId === access.permission_profile_id) return;
    setUpdatingAccessId(access.id);
    const res = await updateCollaboratorPermissionProfile({
      companyId,
      accessId: access.id,
      permissionProfileId: profileId,
      userId: access.user_id,
    });
    setUpdatingAccessId(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Perfil atualizado.");
      await load();
    }
  };

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Acesso à plataforma</CardTitle>
            <CardDescription>
              Proprietário e colaboradores com login no Faro. O proprietário tem
              acesso total e não pode ter o perfil alterado.
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
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-x-auto">
              <div
                className={cn(
                  "hidden border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid",
                  TABLE_GRID,
                )}
                role="row"
              >
                <span>Nome</span>
                <span>E-mail</span>
                <span>Perfil</span>
                <span className="text-center">Status</span>
                <span className="text-center">Ações</span>
              </div>
              <ul className="divide-y">
                <li className={cn("flex flex-col gap-3 px-4 py-4", TABLE_GRID)}>
                  <TableField label="Nome">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{ownerDisplayName}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Proprietário
                      </Badge>
                    </div>
                  </TableField>
                  <TableField label="E-mail">
                    <p className="truncate text-sm text-muted-foreground">
                      {ownerEmail ?? "—"}
                    </p>
                  </TableField>
                  <TableField label="Perfil">
                    <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground">
                      Proprietário
                    </div>
                  </TableField>
                  <TableField label="Status" className="md:text-center">
                    <div className="flex md:justify-center">
                      <AccessStatusBadge status="owner" />
                    </div>
                  </TableField>
                  <div className="hidden md:block" aria-hidden />
                </li>

                {accessList.map((a) => {
                  const profileName =
                    (a.user_id && memberNamesByUserId[a.user_id]) || null;
                  const displayName =
                    profileName ??
                    (a.email.includes("@")
                      ? a.email.split("@")[0]
                      : a.email);
                  return (
                    <li
                      key={a.id}
                      className={cn("flex flex-col gap-3 px-4 py-4", TABLE_GRID)}
                    >
                      <TableField label="Nome">
                        <p className="truncate font-medium">{displayName}</p>
                      </TableField>
                      <TableField label="E-mail">
                        <p className="truncate text-sm text-muted-foreground">
                          {a.email}
                        </p>
                      </TableField>
                      <TableField label="Perfil">
                        <Select
                          value={a.permission_profile_id}
                          disabled={updatingAccessId === a.id}
                          onValueChange={(profileId) =>
                            void handleProfileChange(a, profileId)
                          }
                        >
                          <SelectTrigger className="h-9 w-full">
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
                      </TableField>
                      <TableField label="Status" className="md:text-center">
                        <div className="flex md:justify-center">
                          <AccessStatusBadge
                            status={
                              a.status === "pending" ? "pending" : "active"
                            }
                          />
                        </div>
                      </TableField>
                      <div className="flex justify-end md:justify-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void handleRevoke(a.id)}
                              aria-label="Revogar acesso"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Revogar acesso</TooltipContent>
                        </Tooltip>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {accessList.length === 0 ? (
                <p className="border-t px-4 py-6 text-sm text-muted-foreground">
                  Nenhum colaborador cadastrado além do proprietário. Use{" "}
                  <strong>Adicionar acesso</strong> para convidar por e-mail.
                </p>
              ) : null}
            </div>
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

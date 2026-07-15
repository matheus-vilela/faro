import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type PermissionKey,
} from "@/lib/permissions";
import {
  createPermissionProfile,
  deletePermissionProfile,
  fetchCompanyPermissionProfiles,
  updatePermissionProfile,
} from "@/services/companyAccessService";
import type { CompanyPermissionProfile } from "@/types/companyPermissions";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function ProfilePermissionsEditor({
  permissions,
  onChange,
  disabled,
}: {
  permissions: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
}) {
  const set = useMemo(() => new Set(permissions), [permissions]);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSION_KEYS.map((key) => (
        <label
          key={key}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
        >
          <Checkbox
            checked={set.has(key)}
            disabled={disabled}
            onCheckedChange={(checked) => {
              const next = new Set(set);
              if (checked) next.add(key);
              else next.delete(key);
              onChange(PERMISSION_KEYS.filter((k) => next.has(k)));
            }}
          />
          {PERMISSION_LABELS[key]}
        </label>
      ))}
    </div>
  );
}

/** Cadastro e listagem de perfis de permissão. Visível só para o proprietário. */
export function PermissionProfilesSection() {
  const { currentCompany, isCompanyOwner } = useCompany();
  const companyId = currentCompany?.id;

  const [profiles, setProfiles] = useState<CompanyPermissionProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<CompanyPermissionProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profilePermissions, setProfilePermissions] = useState<PermissionKey[]>(
    [],
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !isCompanyOwner) return;
    setLoading(true);
    const res = await fetchCompanyPermissionProfiles(companyId);
    if (res.error) toast.error(res.error);
    setProfiles(res.profiles);
    setLoading(false);
  }, [companyId, isCompanyOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isCompanyOwner) return null;

  const openNewProfile = () => {
    setEditingProfile(null);
    setProfileName("");
    setProfilePermissions([...PERMISSION_KEYS]);
    setProfileDialogOpen(true);
  };

  const openEditProfile = (p: CompanyPermissionProfile) => {
    setEditingProfile(p);
    setProfileName(p.name);
    setProfilePermissions([...p.permissions]);
    setProfileDialogOpen(true);
  };

  const saveProfile = async () => {
    if (!companyId || !profileName.trim()) return;
    setSavingProfile(true);
    if (editingProfile) {
      const res = await updatePermissionProfile({
        profileId: editingProfile.id,
        name: profileName,
        permissions: profilePermissions,
      });
      if (res.error) toast.error(res.error);
      else toast.success("Perfil atualizado.");
    } else {
      const res = await createPermissionProfile({
        companyId,
        name: profileName,
        permissions: profilePermissions,
      });
      if (res.error) toast.error(res.error);
      else toast.success("Perfil criado.");
    }
    setSavingProfile(false);
    setProfileDialogOpen(false);
    await load();
  };

  const handleDeleteProfile = async (profileId: string) => {
    const res = await deletePermissionProfile(profileId);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Perfil removido.");
      await load();
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Perfis de permissão</CardTitle>
            <CardDescription>
              O perfil padrão libera todas as seções. Crie perfis customizados
              para restringir áreas da plataforma.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0 w-full sm:w-auto"
            onClick={openNewProfile}
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo perfil
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum perfil cadastrado. Clique em{" "}
              <strong>Novo perfil</strong> para criar um.
            </p>
          ) : (
            profiles.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {p.name}
                      {p.is_system ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (sistema)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.permissions.length} seção(ões) liberada(s)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openEditProfile(p)}
                    >
                      Editar
                    </Button>
                    {!p.is_system ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => void handleDeleteProfile(p.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? "Editar perfil" : "Novo perfil"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Nome</Label>
              <Input
                id="profile-name"
                value={profileName}
                disabled={editingProfile?.is_system === true}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>
            <ProfilePermissionsEditor
              permissions={profilePermissions}
              onChange={setProfilePermissions}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => void saveProfile()}
              disabled={savingProfile || !profileName.trim()}
            >
              {savingProfile ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

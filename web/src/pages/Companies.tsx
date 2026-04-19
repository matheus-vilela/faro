import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { isValidCnpj } from "@/lib/cnpj";
import {
  hasDuplicateUnitNameInGroup,
  mapCompanyUnitMutationError,
} from "@/lib/companyUnitName";
import { maskCpfCnpj, unmask } from "@/lib/masks";
import { ROLE_LABELS } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyGroup } from "@/types/companyGroup";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export function Companies() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gestao = searchParams.get("gestao") === "1";

  const { user } = useAuth();
  const {
    groupsWithCompanies,
    currentCompany,
    setCurrentCompany,
    refetchCompanies,
    loading: companiesLoading,
  } = useCompany();
  const { openModal } = useUnitSetupModal();

  useEffect(() => {
    if (
      !gestao &&
      !companiesLoading &&
      groupsWithCompanies.length > 0 &&
      currentCompany
    ) {
      navigate("/app", { replace: true });
    }
  }, [
    gestao,
    companiesLoading,
    groupsWithCompanies.length,
    currentCompany,
    navigate,
  ]);

  const [renameGroup, setRenameGroup] = useState<CompanyGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    company: Company;
    groupName: string;
  } | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editName, setEditName] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const [renameValue, setRenameValue] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroupOwner = (g: CompanyGroup) =>
    !!user && g.owner_user_id === user.id;

  const handleSelectCompany = (company: Company) => {
    setCurrentCompany(company);
    navigate("/app", { replace: true });
  };

  const handleRenameGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameGroup) return;
    setLoading(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("company_groups")
        .update({ name: renameValue.trim() })
        .eq("id", renameGroup.id);
      if (uErr) throw uErr;
      await refetchCompanies();
      setRenameGroup(null);
      setRenameValue("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao renomear grupo");
    } finally {
      setLoading(false);
    }
  };

  const openEditCompany = (company: Company) => {
    setEditingCompany(company);
    setEditName(company.name);
    setEditDocument(maskCpfCnpj(company.document ?? ""));
    setEditEmail(company.email ?? "");
    setError(null);
  };

  const handleUpdateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany) return;
    const docDigits = unmask(editDocument);
    if (!isValidCnpj(docDigits)) {
      setError("Informe um CNPJ válido.");
      return;
    }
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setError("Informe o nome da unidade.");
      return;
    }
    const gwcEdit = groupsWithCompanies.find(
      (g) => g.group.id === editingCompany.group_id,
    );
    if (
      hasDuplicateUnitNameInGroup(
        trimmedName,
        editingCompany.group_id,
        gwcEdit?.companies ?? [],
        editingCompany.id,
      )
    ) {
      setError("Já existe uma unidade com este nome neste grupo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("companies")
        .update({
          name: trimmedName,
          document: docDigits,
          email: editEmail.trim() || null,
        })
        .eq("id", editingCompany.id);
      if (uErr) throw uErr;
      await refetchCompanies();
      setEditingCompany(null);
      setEditName("");
      setEditDocument("");
      setEditEmail("");
    } catch (err: unknown) {
      setError(mapCompanyUnitMutationError(err, "Erro ao atualizar unidade"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!deleteTarget) return;
    setLoading(true);
    setError(null);
    try {
      const { error: dErr } = await supabase
        .from("companies")
        .delete()
        .eq("id", deleteTarget.company.id);
      if (dErr) throw dErr;
      await refetchCompanies();
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao remover unidade");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  if (companiesLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">
          Carregando empresas...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PageShell className="max-w-2xl space-y-6 pb-0">
        <PageHeader
          className="flex-col items-center text-center sm:flex-col sm:items-center"
          title="Grupos e unidades"
          description="Cada grupo reúne uma ou mais empresas (unidades)."
          icon={Building2}
        />

        <div className="grid gap-6">
          {groupsWithCompanies.map(({ group, companies: ucs }) => {
            const owner = isGroupOwner(group);
            return (
              <Card key={group.id}>
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-lg">{group.name}</CardTitle>
                        {owner && (
                          <CardDescription>
                            Você é o dono deste grupo
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    {owner && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRenameGroup(group);
                            setRenameValue(group.name);
                            setError(null);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Renomear grupo
                        </Button>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => {
                            openModal({ kind: "add_unit", groupId: group.id });
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Nova unidade
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 pt-1">
                    {ucs.map(({ company, role }) => (
                      <div
                        key={company.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                      >
                        <button
                          type="button"
                          className="flex flex-1 min-w-0 flex-col items-start text-left hover:opacity-80"
                          onClick={() => handleSelectCompany(company)}
                        >
                          <span className="font-medium truncate">
                            {company.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ROLE_LABELS[role]}
                          </span>
                          {company.document && (
                            <span className="text-xs text-muted-foreground">
                              CNPJ: {maskCpfCnpj(company.document)}
                            </span>
                          )}
                        </button>
                        {owner && (
                          <div className="flex shrink-0 gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  aria-label="Editar unidade"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openEditCompany(company);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Editar</TooltipContent>
                            </Tooltip>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 text-destructive hover:text-destructive"
                              title="Remover unidade"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDeleteTarget({
                                  company,
                                  groupName: group.name,
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            onClick={() => openModal({ kind: "new_group" })}
            className="flex-1"
          >
            Novo grupo
          </Button>
          <Button
            variant="outline"
            onClick={() => supabase.auth.signOut()}
            className="flex-1"
          >
            Sair
          </Button>
        </div>
      </PageShell>

      <Sheet
        open={!!editingCompany}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCompany(null);
            setEditName("");
            setEditDocument("");
            setEditEmail("");
            setError(null);
          }
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Editar unidade</SheetTitle>
            <SheetDescription>
              Atualize nome, CNPJ e e-mail da unidade. O CNPJ deve ser válido.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleUpdateUnit} className="space-y-4 py-4">
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-unit-name">Nome da unidade *</Label>
              <Input
                id="edit-unit-name"
                placeholder="Nome do bar/restaurante"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-document">CNPJ *</Label>
              <Input
                id="edit-document"
                placeholder="00.000.000/0001-00"
                inputMode="numeric"
                autoComplete="off"
                value={editDocument}
                onChange={(e) => setEditDocument(maskCpfCnpj(e.target.value))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="contato@estabelecimento.com"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingCompany(null);
                  setEditName("");
                  setEditDocument("");
                  setEditEmail("");
                  setError(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!renameGroup}
        onOpenChange={(open) => {
          if (!open) {
            setRenameGroup(null);
            setRenameValue("");
            setError(null);
          }
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Renomear grupo</SheetTitle>
            <SheetDescription>
              Apenas o dono pode alterar o nome do grupo.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleRenameGroup} className="space-y-4 py-4">
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="rename">Nome do grupo *</Label>
              <Input
                id="rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                required
              />
            </div>
            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRenameGroup(null);
                  setRenameValue("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover unidade?</DialogTitle>
            <DialogDescription>
              A unidade <strong>{deleteTarget?.company.name}</strong> do grupo{" "}
              <strong>{deleteTarget?.groupName}</strong> será excluída. Esta
              ação não pode ser desfeita se houver dados vinculados.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => void handleDeleteCompany()}
            >
              {loading ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

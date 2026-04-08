import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import type { Company } from "@/contexts/CompanyContext";
import {
  getLastCompanyStorageKey,
  useCompany,
} from "@/contexts/CompanyContext";
import { isValidCnpj } from "@/lib/cnpj";
import {
  hasDuplicateUnitNameInGroup,
  mapCompanyUnitMutationError,
} from "@/lib/companyUnitName";
import { maskCpfCnpj, unmask } from "@/lib/masks";
import { ROLE_LABELS } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Building2,
  Check,
  ChevronDown,
  Layers,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export function CompanySelector() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    groupsWithCompanies,
    currentCompany,
    currentGroup,
    setCurrentCompany,
    refetchCompanies,
    isGroupOwner,
  } = useCompany();

  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [firstUnitName, setFirstUnitName] = useState("");
  const [groupDocument, setGroupDocument] = useState("");
  const [groupEmail, setGroupEmail] = useState("");

  const [createUnitOpen, setCreateUnitOpen] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitDocument, setUnitDocument] = useState("");
  const [unitEmail, setUnitEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitsInCurrentGroup = useMemo(() => {
    if (!currentCompany) return [];
    const gwc = groupsWithCompanies.find(
      (g) => g.group.id === currentCompany.group_id,
    );
    return gwc?.companies ?? [];
  }, [groupsWithCompanies, currentCompany]);

  const resetGroupForm = () => {
    setGroupName("");
    setFirstUnitName("");
    setGroupDocument("");
    setGroupEmail("");
  };

  const resetUnitForm = () => {
    setUnitName("");
    setUnitDocument("");
    setUnitEmail("");
  };

  const handleSelectGroup = (groupId: string) => {
    if (!currentCompany) return;
    if (currentCompany.group_id === groupId) return;
    const gwc = groupsWithCompanies.find((g) => g.group.id === groupId);
    if (!gwc?.companies.length) return;
    setCurrentCompany(gwc.companies[0].company);
  };

  const handleSelectUnit = (company: Company) => {
    setCurrentCompany(company);
  };

  const handleCreateGroupAndFirstUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const docDigits = unmask(groupDocument);
    if (!isValidCnpj(docDigits)) {
      setError("Informe um CNPJ válido.");
      return;
    }
    const trimmedFirstUnit = firstUnitName.trim();
    if (!trimmedFirstUnit) {
      setError("Informe o nome da primeira unidade.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const groupId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const { error: gErr } = await supabase.from("company_groups").insert({
        id: groupId,
        name: groupName.trim() || "Default",
        owner_user_id: user.id,
      });
      if (gErr) throw gErr;

      const { error: cErr } = await supabase.from("companies").insert({
        id: companyId,
        group_id: groupId,
        name: trimmedFirstUnit,
        document: docDigits,
        email: groupEmail.trim() || null,
      });
      if (cErr) throw cErr;

      const { error: uErr } = await supabase.from("user_companies").insert({
        user_id: user.id,
        company_id: companyId,
        role: "owner",
      });
      if (uErr) throw uErr;

      localStorage.setItem(getLastCompanyStorageKey(user.id), companyId);
      await refetchCompanies();
      setCreateGroupOpen(false);
      resetGroupForm();
    } catch (err: unknown) {
      setError(
        mapCompanyUnitMutationError(err, "Erro ao criar grupo e unidade"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUnitInCurrentGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !currentCompany) return;
    const docDigits = unmask(unitDocument);
    if (!isValidCnpj(docDigits)) {
      setError("Informe um CNPJ válido.");
      return;
    }
    const trimmedUnit = unitName.trim();
    if (!trimmedUnit) {
      setError("Informe o nome da unidade.");
      return;
    }
    if (
      hasDuplicateUnitNameInGroup(
        trimmedUnit,
        currentCompany.group_id,
        unitsInCurrentGroup,
      )
    ) {
      setError("Já existe uma unidade com este nome neste grupo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const companyId = crypto.randomUUID();
      const { error: companyError } = await supabase.from("companies").insert({
        id: companyId,
        group_id: currentCompany.group_id,
        name: trimmedUnit,
        document: docDigits,
        email: unitEmail.trim() || null,
      });

      if (companyError) throw companyError;

      const { error: linkError } = await supabase
        .from("user_companies")
        .insert({
          user_id: user.id,
          company_id: companyId,
          role: "owner",
        });

      if (linkError) throw linkError;

      localStorage.setItem(getLastCompanyStorageKey(user.id), companyId);
      await refetchCompanies();
      setCreateUnitOpen(false);
      resetUnitForm();
    } catch (err: unknown) {
      setError(mapCompanyUnitMutationError(err, "Erro ao criar unidade"));
    } finally {
      setLoading(false);
    }
  };

  const openCreateGroupDialog = () => {
    setError(null);
    resetGroupForm();
    setCreateGroupOpen(true);
  };

  const openCreateUnitDialog = () => {
    setError(null);
    resetUnitForm();
    setCreateUnitOpen(true);
  };

  if (!currentCompany) return null;

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 sm:gap-2",
          "max-w-[min(100vw-8rem,520px)] md:max-w-none",
        )}
      >
        <span className="sr-only">Grupo e unidade ativos</span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-0 shrink gap-1.5 px-2 sm:px-3 md:max-w-[200px]"
              title={currentGroup?.name ?? "Grupo"}
              aria-label={`Grupo: ${currentGroup?.name ?? ""}`}
            >
              <Layers className="h-4 w-4 shrink-0" />
              <span className="hidden min-w-0 truncate sm:inline">
                {currentGroup?.name ?? "—"}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Grupo
            </div>
            {groupsWithCompanies.map(({ group }) => (
              <DropdownMenuItem
                key={group.id}
                onClick={() => handleSelectGroup(group.id)}
                className="gap-2"
              >
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{group.name}</span>
                {group.id === currentGroup?.id && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={openCreateGroupDialog}
              className="gap-2 text-primary focus:text-primary"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Novo grupo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-0 shrink gap-1.5 px-2 sm:px-3 md:max-w-[220px]"
              title={currentCompany.name}
              aria-label={`Unidade: ${currentCompany.name}`}
            >
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="hidden min-w-0 truncate sm:inline">
                {currentCompany.name}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px]">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Unidade neste grupo
              {/* {currentGroup?.name ? (
                <span className="block truncate font-normal text-muted-foreground/90">
                  {currentGroup.name}
                </span>
              ) : null} */}
            </div>
            {unitsInCurrentGroup.map(({ company, role }) => (
              <DropdownMenuItem
                key={company.id}
                onClick={() => handleSelectUnit(company)}
                className="gap-2"
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate",
                      company.id === currentCompany.id && "font-medium",
                    )}
                  >
                    {company.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[role]}
                  </span>
                </div>
                {company.id === currentCompany.id && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            {isGroupOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={openCreateUnitDialog}
                  className="gap-2 text-primary focus:text-primary"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  Nova unidade
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 hidden sm:block"
              title="Mais opções de grupo e unidades"
              aria-label="Mais opções de grupo e unidades"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuItem onClick={() => navigate("/empresas?gestao=1")}>
              Gerenciar grupos e unidades
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={createGroupOpen}
        onOpenChange={(open) => {
          setCreateGroupOpen(open);
          if (!open) {
            setError(null);
            resetGroupForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo grupo</DialogTitle>
            <DialogDescription>
              Defina o nome do grupo e da primeira unidade. Você será o dono do
              grupo e poderá adicionar mais unidades depois.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateGroupAndFirstUnit}>
            <div className="grid gap-4 py-4">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-group-name">Nome do grupo *</Label>
                <Input
                  id="new-group-name"
                  placeholder="Ex.: Rede Centro"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-group-first-unit">
                  Nome da primeira unidade *
                </Label>
                <Input
                  id="new-group-first-unit"
                  placeholder="Nome do bar/restaurante"
                  value={firstUnitName}
                  onChange={(e) => setFirstUnitName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-group-document">CNPJ *</Label>
                <Input
                  id="new-group-document"
                  placeholder="00.000.000/0001-00"
                  inputMode="numeric"
                  autoComplete="off"
                  value={groupDocument}
                  onChange={(e) =>
                    setGroupDocument(maskCpfCnpj(e.target.value))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-group-email">Email</Label>
                <Input
                  id="new-group-email"
                  type="email"
                  placeholder="contato@estabelecimento.com"
                  value={groupEmail}
                  onChange={(e) => setGroupEmail(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateGroupOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Criando..." : "Criar grupo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createUnitOpen}
        onOpenChange={(open) => {
          setCreateUnitOpen(open);
          if (!open) {
            setError(null);
            resetUnitForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova unidade</DialogTitle>
            <DialogDescription>
              A unidade será criada no grupo{" "}
              <strong>{currentGroup?.name ?? "atual"}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUnitInCurrentGroup}>
            <div className="grid gap-4 py-4">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-unit-name">Nome *</Label>
                <Input
                  id="new-unit-name"
                  placeholder="Nome do bar/restaurante"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-unit-document">CNPJ *</Label>
                <Input
                  id="new-unit-document"
                  placeholder="00.000.000/0001-00"
                  inputMode="numeric"
                  autoComplete="off"
                  value={unitDocument}
                  onChange={(e) => setUnitDocument(maskCpfCnpj(e.target.value))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-unit-email">Email</Label>
                <Input
                  id="new-unit-email"
                  type="email"
                  placeholder="contato@estabelecimento.com"
                  value={unitEmail}
                  onChange={(e) => setUnitEmail(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateUnitOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Criando..." : "Criar unidade"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

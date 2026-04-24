import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  Building2,
  Check,
  ChevronDown,
  Layers,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export function CompanySelector() {
  const navigate = useNavigate();
  const {
    groupsWithCompanies,
    currentCompany,
    currentGroup,
    setCurrentCompany,
    isGroupOwner,
  } = useCompany();
  const { openModal } = useUnitSetupModal();

  const unitsInCurrentGroup = useMemo(() => {
    if (!currentCompany) return [];
    const gwc = groupsWithCompanies.find(
      (g) => g.group.id === currentCompany.group_id,
    );
    return gwc?.companies ?? [];
  }, [groupsWithCompanies, currentCompany]);

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
              onClick={() => openModal({ kind: "new_group" })}
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
                  onClick={() =>
                    openModal({
                      kind: "add_unit",
                      groupId: currentCompany.group_id,
                    })
                  }
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
              className="hidden shrink-0 sm:inline-flex"
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

    </>
  );
}

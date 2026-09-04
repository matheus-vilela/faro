import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

const FILTER_ACTIVE_LABELS: Record<"all" | "active" | "inactive", string> = {
  all: "Todos",
  active: "Ativos",
  inactive: "Inativos",
};

const FILTER_STOCK_ALERT_LABELS: Record<
  "all" | "zero" | "below_min" | "any",
  string
> = {
  all: "Todos",
  any: "Com alerta",
  zero: "Estoque zerado",
  below_min: "Abaixo do mínimo",
};

const FILTER_CMV_LABELS: Record<"all" | "yes" | "no", string> = {
  all: "Todos",
  yes: "Compõe CMV",
  no: "Não compõe CMV",
};

const FILTER_STOCK_ONLY_LABELS: Record<"all" | "yes", string> = {
  all: "Todos",
  yes: "Somente estoque",
};

const FILTER_UPDATED_LABELS: Record<
  "all" | "today" | "7d" | "30d" | "custom",
  string
> = {
  all: "Qualquer data",
  today: "Atualizado hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  custom: "Entre datas",
};

export function ProductCatalogFiltersPanel({
  open,
  onOpenChange,
  search,
  onSearchChange,
  filterActive,
  onFilterActiveChange,
  filterCategoryId,
  onFilterCategoryIdChange,
  filterStockAlert,
  onFilterStockAlertChange,
  filterComposesCmv,
  onFilterComposesCmvChange,
  filterStockOnlyOrigin,
  onFilterStockOnlyOriginChange,
  filterUpdatedPreset,
  onFilterUpdatedPresetChange,
  filterUpdatedFrom,
  onFilterUpdatedFromChange,
  filterUpdatedTo,
  onFilterUpdatedToChange,
  lowStockOnly,
  companyProductCategories,
  onClearFilters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filterActive: "all" | "active" | "inactive";
  onFilterActiveChange: (value: "all" | "active" | "inactive") => void;
  filterCategoryId: string;
  onFilterCategoryIdChange: (value: string) => void;
  filterStockAlert: "all" | "zero" | "below_min" | "any";
  onFilterStockAlertChange: (
    value: "all" | "zero" | "below_min" | "any",
  ) => void;
  filterComposesCmv: "all" | "yes" | "no";
  onFilterComposesCmvChange: (value: "all" | "yes" | "no") => void;
  filterStockOnlyOrigin: "all" | "yes";
  onFilterStockOnlyOriginChange: (value: "all" | "yes") => void;
  filterUpdatedPreset: "all" | "today" | "7d" | "30d" | "custom";
  onFilterUpdatedPresetChange: (
    value: "all" | "today" | "7d" | "30d" | "custom",
  ) => void;
  filterUpdatedFrom: string;
  onFilterUpdatedFromChange: (value: string) => void;
  filterUpdatedTo: string;
  onFilterUpdatedToChange: (value: string) => void;
  lowStockOnly: boolean;
  companyProductCategories: CompanyProductCategory[];
  onClearFilters: () => void;
}) {
  const advancedFilterCount =
    (filterActive !== "active" ? 1 : 0) +
    (filterCategoryId !== "all" ? 1 : 0) +
    (filterStockAlert !== "all" || lowStockOnly ? 1 : 0) +
    (filterComposesCmv !== "all" ? 1 : 0) +
    (filterStockOnlyOrigin !== "all" ? 1 : 0) +
    (filterUpdatedPreset !== "all" ? 1 : 0);

  const hasAnyFilter = advancedFilterCount > 0 || search.trim().length > 0;

  const categoryName =
    filterCategoryId !== "all"
      ? companyProductCategories.find((c) => c.id === filterCategoryId)?.name
      : null;

  const activeFilterChips: Array<{ key: string; label: string }> = [];
  if (search.trim()) {
    activeFilterChips.push({
      key: "search",
      label: `Busca: “${search.trim()}”`,
    });
  }
  if (filterActive !== "active") {
    activeFilterChips.push({
      key: "active",
      label: FILTER_ACTIVE_LABELS[filterActive],
    });
  }
  if (categoryName) {
    activeFilterChips.push({ key: "category", label: categoryName });
  }
  if (lowStockOnly) {
    activeFilterChips.push({ key: "lowStock", label: "Estoque baixo" });
  } else if (filterStockAlert !== "all") {
    activeFilterChips.push({
      key: "stock",
      label: FILTER_STOCK_ALERT_LABELS[filterStockAlert],
    });
  }
  if (filterComposesCmv !== "all") {
    activeFilterChips.push({
      key: "cmv",
      label: FILTER_CMV_LABELS[filterComposesCmv],
    });
  }
  if (filterStockOnlyOrigin !== "all") {
    activeFilterChips.push({
      key: "stockOnly",
      label: FILTER_STOCK_ONLY_LABELS[filterStockOnlyOrigin],
    });
  }
  if (filterUpdatedPreset !== "all") {
    activeFilterChips.push({
      key: "updated",
      label: FILTER_UPDATED_LABELS[filterUpdatedPreset],
    });
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="prod-search"
              placeholder="Buscar por nome ou SKU…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-10 w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant={open ? "secondary" : "outline"}
                size="sm"
                className="h-10 gap-2 sm:h-9"
                aria-expanded={open}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filtros
                {advancedFilterCount > 0 ? (
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 rounded-full px-1.5 text-[0.65rem] font-semibold"
                  >
                    {advancedFilterCount}
                  </Badge>
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 opacity-70 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {!open && hasAnyFilter ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Filtros ativos:
            </span>
            {activeFilterChips.map((chip) => (
              <Badge
                key={chip.key}
                variant="outline"
                className="max-w-full truncate font-normal"
              >
                {chip.label}
              </Badge>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={onClearFilters}
            >
              <X className="h-3 w-3" />
              Limpar
            </Button>
          </div>
        ) : null}

        <CollapsibleContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Refine a lista por situação, categoria, alertas de estoque, origem
            (somente estoque), CMV e data de atualização.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Situação</Label>
              <Select
                value={filterActive}
                onValueChange={(v) =>
                  onFilterActiveChange(v as "all" | "active" | "inactive")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="inactive">Inativos</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Categoria</Label>
              <Select
                value={filterCategoryId}
                onValueChange={onFilterCategoryIdChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {companyProductCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Alerta de estoque
              </Label>
              {lowStockOnly ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Apenas ≤ mínimo (link estoque baixo)
                </p>
              ) : (
                <Select
                  value={filterStockAlert}
                  onValueChange={(v) =>
                    onFilterStockAlertChange(
                      v as "all" | "zero" | "below_min" | "any",
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="any">Com alerta</SelectItem>
                    <SelectItem value="zero">Estoque zerado</SelectItem>
                    <SelectItem value="below_min">
                      Abaixo do mínimo (com saldo)
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Origem
              </Label>
              <Select
                value={filterStockOnlyOrigin}
                onValueChange={(v) =>
                  onFilterStockOnlyOriginChange(v as "all" | "yes")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="yes">Somente estoque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Compõe CMV</Label>
              <Select
                value={filterComposesCmv}
                onValueChange={(v) =>
                  onFilterComposesCmvChange(v as "all" | "yes" | "no")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="yes">Sim</SelectItem>
                  <SelectItem value="no">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Atualizado em
              </Label>
              <Select
                value={filterUpdatedPreset}
                onValueChange={(v) =>
                  onFilterUpdatedPresetChange(
                    v as "all" | "today" | "7d" | "30d" | "custom",
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Qualquer data</SelectItem>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="custom">Entre datas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {filterUpdatedPreset === "custom" ? (
              <>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="upd-from"
                    className="text-xs text-muted-foreground"
                  >
                    De
                  </Label>
                  <Input
                    id="upd-from"
                    type="date"
                    value={filterUpdatedFrom}
                    onChange={(e) => onFilterUpdatedFromChange(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="upd-to"
                    className="text-xs text-muted-foreground"
                  >
                    Até
                  </Label>
                  <Input
                    id="upd-to"
                    type="date"
                    value={filterUpdatedTo}
                    onChange={(e) => onFilterUpdatedToChange(e.target.value)}
                    className="w-full"
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onClearFilters}
              disabled={!hasAnyFilter}
            >
              Limpar filtros
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  PRODUCT_CATALOG_KIND_LABELS,
  PRODUCT_CATALOG_KINDS,
  type ProductCatalogKind,
} from "@/lib/productCatalogKind";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { Search, SlidersHorizontal } from "lucide-react";

const INLINE_SELECT_MIN_PX = 158;

function useInlinePriorityCount(enabled: boolean) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(enabled ? 3 : 0);

  useLayoutEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const row = rowRef.current;
    if (!row) return;

    const measure = () => {
      const search = row.querySelector("[data-catalog-search]");
      const actions = row.querySelector("[data-catalog-actions]");
      const searchW = search instanceof HTMLElement ? search.offsetWidth : 0;
      const actionsW = actions instanceof HTMLElement ? actions.offsetWidth : 0;
      const styles = getComputedStyle(row);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "12") || 12;
      const pad =
        Number.parseFloat(styles.paddingLeft) +
        Number.parseFloat(styles.paddingRight);
      const available = row.clientWidth - pad - searchW - actionsW - gap * 2;
      const per = INLINE_SELECT_MIN_PX + gap;
      setCount(Math.max(0, Math.min(3, Math.floor((available + gap) / per))));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(row);
    measure();
    return () => ro.disconnect();
  }, [enabled]);

  return { rowRef, inlineCount: count };
}

function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ProductCatalogFiltersPanel({
  search,
  onSearchChange,
  filterCatalogKind,
  onFilterCatalogKindChange,
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
  search: string;
  onSearchChange: (value: string) => void;
  filterCatalogKind: ProductCatalogKind;
  onFilterCatalogKindChange: (value: ProductCatalogKind) => void;
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
  const isMobile = useIsMobile();
  const { rowRef, inlineCount } = useInlinePriorityCount(!isMobile);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const showKind = inlineCount >= 1;
  const showCategory = inlineCount >= 2;
  const showAlert = inlineCount >= 3;

  const extraFilterCount =
    (filterActive !== "active" ? 1 : 0) +
    (filterComposesCmv !== "all" ? 1 : 0) +
    (filterStockOnlyOrigin !== "all" ? 1 : 0) +
    (filterUpdatedPreset !== "all" ? 1 : 0) +
    (!showKind && filterCatalogKind !== "all" ? 1 : 0) +
    (!showCategory && filterCategoryId !== "all" ? 1 : 0) +
    (!showAlert && (filterStockAlert !== "all" || lowStockOnly) ? 1 : 0);

  const hasAnyFilter =
    search.trim().length > 0 ||
    filterCatalogKind !== "all" ||
    filterActive !== "active" ||
    filterCategoryId !== "all" ||
    filterStockAlert !== "all" ||
    lowStockOnly ||
    filterComposesCmv !== "all" ||
    filterStockOnlyOrigin !== "all" ||
    filterUpdatedPreset !== "all";

  const kindField = (inline: boolean) => (
    <FilterField
      label="Tipo"
      className={
        inline
          ? "w-[158px] shrink-0 space-y-1.5"
          : "space-y-1.5"
      }
    >
      <Select
        value={filterCatalogKind}
        onValueChange={(v) =>
          onFilterCatalogKindChange(v as ProductCatalogKind)
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_CATALOG_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {PRODUCT_CATALOG_KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );

  const categoryField = (inline: boolean) => (
    <FilterField
      label="Categoria"
      className={
        inline
          ? "w-[168px] shrink-0 space-y-1.5"
          : "space-y-1.5"
      }
    >
      <Select value={filterCategoryId} onValueChange={onFilterCategoryIdChange}>
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
    </FilterField>
  );

  const alertField = (inline: boolean) => (
    <FilterField
      label="Alerta de estoque"
      className={
        inline
          ? "w-[168px] shrink-0 space-y-1.5"
          : "space-y-1.5"
      }
    >
      {lowStockOnly ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas ≤ mínimo
        </p>
      ) : (
        <Select
          value={filterStockAlert}
          onValueChange={(v) =>
            onFilterStockAlertChange(v as "all" | "zero" | "below_min" | "any")
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="any">Com alerta</SelectItem>
            <SelectItem value="zero">Estoque zerado</SelectItem>
            <SelectItem value="below_min">Abaixo do mínimo</SelectItem>
          </SelectContent>
        </Select>
      )}
    </FilterField>
  );

  const extraFields = (
    <>
      {!showKind ? kindField(false) : null}
      {!showCategory ? categoryField(false) : null}
      {!showAlert ? alertField(false) : null}
      <FilterField label="Situação">
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
      </FilterField>
      <FilterField label="Origem">
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
      </FilterField>
      <FilterField label="Compõe CMV">
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
      </FilterField>
      <FilterField label="Atualizado em">
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
      </FilterField>
      {filterUpdatedPreset === "custom" ? (
        <>
          <FilterField label="De">
            <Input
              type="date"
              value={filterUpdatedFrom}
              onChange={(e) => onFilterUpdatedFromChange(e.target.value)}
              className="w-full"
            />
          </FilterField>
          <FilterField label="Até">
            <Input
              type="date"
              value={filterUpdatedTo}
              onChange={(e) => onFilterUpdatedToChange(e.target.value)}
              className="w-full"
            />
          </FilterField>
        </>
      ) : null}
    </>
  );

  const filtersButton = (
    <Button
      type="button"
      variant={filtersOpen || extraFilterCount > 0 ? "secondary" : "outline"}
      size="sm"
      className="h-9 shrink-0 gap-2"
      aria-expanded={filtersOpen}
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filtros
      {extraFilterCount > 0 ? (
        <Badge
          variant="secondary"
          className="h-5 min-w-5 rounded-full px-1.5 text-[0.65rem] font-semibold"
        >
          {extraFilterCount}
        </Badge>
      ) : null}
    </Button>
  );

  return (
    <div
      ref={rowRef}
      className="mb-4 flex flex-nowrap items-end gap-3 rounded-xl border border-border/80 bg-muted/20 p-3"
    >
      <div
        data-catalog-search
        className="relative min-w-0 flex-1 md:w-44 md:flex-none"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="prod-search"
          placeholder="Nome ou SKU…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 w-full pl-8"
        />
      </div>

      <div className="hidden min-w-0 md:contents">
        {showKind ? kindField(true) : null}
        {showCategory ? categoryField(true) : null}
        {showAlert ? alertField(true) : null}
      </div>

      <div data-catalog-actions className="flex shrink-0 items-center gap-2">
        {isMobile ? (
          <>
            <Button
              type="button"
              variant={
                filtersOpen || extraFilterCount > 0 ? "secondary" : "outline"
              }
              size="sm"
              className="h-9 shrink-0 gap-2"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {extraFilterCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 rounded-full px-1.5 text-[0.65rem] font-semibold"
                >
                  {extraFilterCount}
                </Badge>
              ) : null}
            </Button>
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetContent className="flex flex-col">
                <SheetHeader>
                  <SheetTitle>Filtros</SheetTitle>
                </SheetHeader>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
                  {extraFields}
                </div>
                <SheetFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClearFilters}
                    disabled={!hasAnyFilter}
                  >
                    Limpar filtros
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>{filtersButton}</PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              {extraFields}
            </PopoverContent>
          </Popover>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-9 shrink-0 md:inline-flex"
          onClick={onClearFilters}
          disabled={!hasAnyFilter}
        >
          Limpar filtros
        </Button>
      </div>
    </div>
  );
}

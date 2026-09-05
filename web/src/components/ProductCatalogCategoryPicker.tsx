import {
  SearchSelect,
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  type SearchSelectOption,
} from "@/components/ui/search-select";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { useMemo } from "react";

const NONE = "__none__";

export function ProductCatalogCategoryPicker({
  value,
  onValueChange,
  categories,
  disabled,
  placeholder = "Sem categoria",
  allowClear = false,
  compact = false,
}: {
  value: string;
  onValueChange: (id: string) => void;
  categories: CompanyProductCategory[];
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  compact?: boolean;
}) {
  const options: SearchSelectOption[] = useMemo(
    () =>
      [...categories]
        .filter((c) => c.ativo !== false)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );

  const leadingOptions: SearchSelectOption[] = allowClear
    ? [{ value: NONE, label: placeholder }]
    : [];

  return (
    <SearchSelect
      value={value || (allowClear ? NONE : "")}
      onValueChange={(next) => onValueChange(next === NONE ? "" : next)}
      options={options}
      leadingOptions={leadingOptions}
      placeholder={placeholder}
      searchPlaceholder="Buscar categoria…"
      emptyMessage="Nenhuma categoria de produto."
      disabled={disabled}
      triggerClassName={cn(compact && "h-8 text-xs")}
      contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
    />
  );
}

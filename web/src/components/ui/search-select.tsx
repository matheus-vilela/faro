import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Texto secundário no item (ex.: documento, estoque). */
  description?: string;
  /** Texto extra para filtro (sku, documento, etc.). */
  keywords?: string;
  /** Destaque visual (ex.: ação "Criar…"). */
  accent?: boolean;
};

/** Opção de produto com estoque/SKU no description (busca inclui ambos). */
export function productSearchOption(p: {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  current_quantity?: number | null;
  last_unit_value?: number | null;
}): SearchSelectOption {
  const stock =
    p.current_quantity != null
      ? `Estoque: ${Number(p.current_quantity).toLocaleString("pt-BR")}${
          p.unit ? ` ${p.unit}` : ""
        }`
      : p.unit
        ? `Unidade: ${p.unit}`
        : undefined;
  const lastPrice =
    p.last_unit_value != null && p.last_unit_value > 0
      ? `Último: ${Number(p.last_unit_value).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })}`
      : undefined;
  const description = [stock, lastPrice].filter(Boolean).join(" · ") || undefined;
  return {
    value: p.id,
    label: p.sku ? `${p.name} (${p.sku})` : p.name,
    description,
    keywords: [p.name, p.sku, p.unit].filter(Boolean).join(" "),
  };
}

export function supplierSearchOption(s: {
  id: string;
  name: string;
  document?: string | null;
}): SearchSelectOption {
  return {
    value: s.id,
    label: s.name,
    description: s.document || undefined,
    keywords: [s.name, s.document].filter(Boolean).join(" "),
  };
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function optionMatches(option: SearchSelectOption, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeSearch(
    [option.label, option.description, option.keywords]
      .filter(Boolean)
      .join(" "),
  );
  return haystack.includes(query);
}

export type SearchSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchSelectOption[];
  /** Opções fixas no topo (não filtradas), ex.: "Não vincular". */
  leadingOptions?: SearchSelectOption[];
  /** Opções fixas no fim (não filtradas), ex.: "Criar fornecedor". */
  trailingOptions?: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  id?: string;
  /** Limite de altura da lista. */
  listMaxHeightClassName?: string;
  renderOptionLabel?: (option: SearchSelectOption) => ReactNode;
  /** Notifica o texto da busca (ex.: pré-preencher CNPJ ao criar). */
  onSearchChange?: (query: string) => void;
};

/** Lista mais larga que o trigger — células estreitas de tabela. */
export const SEARCH_SELECT_WIDE_POPOVER_CLASS =
  "z-[100] w-[min(28rem,max(22rem,var(--radix-popover-trigger-width)),calc(100vw-1.5rem))] min-w-[min(22rem,calc(100vw-1.5rem))] max-w-[min(28rem,calc(100vw-1.5rem))]";

export function SearchSelect({
  value,
  onValueChange,
  options,
  leadingOptions = [],
  trailingOptions = [],
  placeholder = "Selecione",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Nenhum item encontrado.",
  disabled,
  triggerClassName,
  contentClassName,
  id,
  listMaxHeightClassName = "max-h-64",
  renderOptionLabel,
  onSearchChange,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const setSearchAndNotify = (next: string) => {
    setSearch(next);
    onSearchChange?.(next);
  };

  const allFixed = useMemo(() => {
    const map = new Map<string, SearchSelectOption>();
    for (const o of [...leadingOptions, ...trailingOptions, ...options]) {
      map.set(o.value, o);
    }
    return map;
  }, [leadingOptions, trailingOptions, options]);

  const selected = value ? allFixed.get(value) : undefined;
  const triggerLabel = selected?.label ?? placeholder;

  const filtered = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return options;
    return options.filter((o) => optionMatches(o, q));
  }, [options, search]);

  const pick = (next: string) => {
    onValueChange(next);
    setOpen(false);
    setSearchAndNotify("");
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
  };

  const renderRow = (option: SearchSelectOption) => {
    const isSelected = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        className={cn(
          "flex w-full items-start justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors",
          "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          isSelected && "bg-accent/80",
          option.accent && "font-medium text-primary",
        )}
        onClick={() => pick(option.value)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2 text-pretty leading-snug">
            {option.accent ? (
              <Plus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : null}
            {renderOptionLabel ? renderOptionLabel(option) : option.label}
          </span>
          {option.description ? (
            <span className="mt-0.5 block text-pretty text-xs text-muted-foreground">
              {option.description}
            </span>
          ) : null}
        </span>
        {isSelected ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : null}
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) setSearchAndNotify("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          id={id}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] p-0",
          contentClassName,
        )}
        onWheel={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearchAndNotify(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>
        <div
          ref={listRef}
          className={cn(
            "overflow-y-auto overscroll-contain p-1",
            listMaxHeightClassName,
          )}
        >
          {leadingOptions.map(renderRow)}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          ) : (
            filtered.map(renderRow)
          )}
        </div>
        {trailingOptions.length > 0 ? (
          <div className="border-t border-border bg-muted/50 p-1">
            {trailingOptions.map(renderRow)}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

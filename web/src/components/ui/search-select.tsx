import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
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
  /** Cabeçalho de grupo na lista (quando muda entre itens). */
  group?: string;
  /** Aba em que a opção aparece (`tabs` no seletor). */
  tab?: string;
};

export type SearchSelectTab = {
  value: string;
  label: string;
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

export const SEARCH_SELECT_CREATE_VALUE = "__search_select_create__";

export type SearchSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SearchSelectOption[];
  /** Opções fixas no topo (não filtradas), ex.: "Não vincular". */
  leadingOptions?: readonly SearchSelectOption[];
  /** Opções fixas no fim (não filtradas), ex.: "Criar fornecedor". */
  trailingOptions?: readonly SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  id?: string;
  /** Limite de altura da lista. */
  listMaxHeightClassName?: string;
  renderOptionLabel?: (option: SearchSelectOption) => ReactNode;
  /** Notifica o texto da busca (ex.: pré-preencher CNPJ ao criar). */
  onSearchChange?: (query: string) => void;
  /** Busca remota em andamento (ou aguardando debounce). */
  loading?: boolean;
  loadingMessage?: string;
  /** `sm` = filtros `h-8`; `default` = `h-10`. */
  size?: "sm" | "default";
  /**
   * Cadastrar o texto da busca. Mostra «Cadastrar «texto»» se não houver
   * item com o mesmo rótulo. Não altera `value`.
   */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  allowCreate?: boolean;
  /** Rodapé do popover (formulário extra ao criar, etc.). */
  footer?: ReactNode;
  /** Não fecha ao clicar em Cadastrar (ex.: formulário no `footer`). */
  keepOpenOnCreate?: boolean;
  /** Texto do trigger (sobrescreve o rótulo da opção selecionada). */
  triggerLabel?: string;
  /** Texto abaixo do campo de busca. */
  searchHint?: string;
  /** Filtra a lista no cliente. Desligue se a busca já for remota. */
  filterLocally?: boolean;
  /** Scroll da lista (ex.: carregar mais). */
  onListScroll?: (el: HTMLDivElement) => void;
  /** X no trigger chama `onValueChange("")`. */
  clearable?: boolean;
  /** Abas no popover (ex.: ficha técnica / produção). */
  tabs?: readonly SearchSelectTab[];
  tab?: string;
  defaultTab?: string;
  onTabChange?: (tab: string) => void;
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
  loading = false,
  loadingMessage = "Buscando…",
  disabled,
  className,
  triggerClassName,
  contentClassName,
  id,
  listMaxHeightClassName = "max-h-64",
  renderOptionLabel,
  onSearchChange,
  size = "default",
  onCreate,
  createLabel,
  allowCreate,
  footer,
  keepOpenOnCreate = false,
  triggerLabel: triggerLabelOverride,
  searchHint,
  filterLocally = true,
  onListScroll,
  clearable = false,
  tabs,
  tab,
  defaultTab,
  onTabChange,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [internalTab, setInternalTab] = useState(
    defaultTab ?? tabs?.[0]?.value ?? "",
  );
  const activeTab = tab ?? internalTab;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const setSearchAndNotify = (next: string) => {
    setSearch(next);
    onSearchChange?.(next);
  };

  const setOpenSafe = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    if (next) {
      setSearchAndNotify("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setSearchAndNotify("");
    }
  };

  const allFixed = useMemo(() => {
    const map = new Map<string, SearchSelectOption>();
    for (const o of [...leadingOptions, ...trailingOptions, ...options]) {
      map.set(o.value, o);
    }
    return map;
  }, [leadingOptions, trailingOptions, options]);

  const selected = value ? allFixed.get(value) : undefined;
  const closedDisplay = triggerLabelOverride ?? selected?.label ?? "";

  const visibleOptions = useMemo(() => {
    if (!tabs?.length || !activeTab) return options;
    return options.filter((o) => !o.tab || o.tab === activeTab);
  }, [activeTab, options, tabs]);

  const filtered = useMemo(() => {
    if (!filterLocally) return visibleOptions;
    const q = normalizeSearch(search);
    if (!q) return visibleOptions;
    return visibleOptions.filter((o) => optionMatches(o, q));
  }, [filterLocally, search, visibleOptions]);

  const createQuery = search.trim();
  const canOfferCreate =
    Boolean(onCreate) &&
    allowCreate !== false &&
    createQuery.length > 0 &&
    ![...leadingOptions, ...visibleOptions, ...trailingOptions].some(
      (o) => normalizeSearch(o.label) === normalizeSearch(createQuery),
    );
  const createOption: SearchSelectOption | null = canOfferCreate
    ? {
        value: SEARCH_SELECT_CREATE_VALUE,
        label: createLabel?.(createQuery) ?? `Cadastrar «${createQuery}»`,
        description: "Novo item",
        accent: true,
      }
    : null;

  const showClear = clearable && Boolean(value) && !disabled;

  const pick = (next: string) => {
    if (next === SEARCH_SELECT_CREATE_VALUE) {
      if (createQuery) onCreate?.(createQuery);
      if (!keepOpenOnCreate) {
        setOpen(false);
        setSearchAndNotify("");
      }
      return;
    }
    onValueChange(next);
    setOpen(false);
    setSearchAndNotify("");
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setOpenSafe(false);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpenSafe(true);
      return;
    }
    if (e.key === "Enter" && open) {
      e.preventDefault();
      if (filtered.length > 0) {
        pick(filtered[0].value);
        return;
      }
      if (createOption) {
        pick(SEARCH_SELECT_CREATE_VALUE);
        return;
      }
      if (leadingOptions.length > 0) {
        pick(leadingOptions[0].value);
      }
    }
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
        onMouseDown={(e) => e.preventDefault()}
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
        // Clique/foco no campo não deve fechar a lista (Anchor ≠ Trigger no Radix).
        if (
          !next &&
          anchorRef.current?.contains(document.activeElement)
        ) {
          return;
        }
        setOpenSafe(next);
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn("relative w-full min-w-0", className)}>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={open ? search : closedDisplay}
            placeholder={
              open
                ? closedDisplay || searchPlaceholder || placeholder
                : placeholder
            }
            onChange={(e) => {
              if (!open) setOpen(true);
              setSearchAndNotify(e.target.value);
            }}
            onFocus={() => {
              if (!disabled && !open) setOpenSafe(true);
            }}
            onKeyDown={handleTriggerKeyDown}
            className={cn(
              "w-full font-normal",
              size === "sm" ? "h-8" : "h-10",
              showClear ? "pr-14" : "pr-9",
              !closedDisplay && !open && "text-muted-foreground",
              triggerClassName,
            )}
          />
          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5">
            {showClear ? (
              <button
                type="button"
                tabIndex={-1}
                className="pointer-events-auto rounded p-0.5 hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onValueChange("");
                  setSearchAndNotify("");
                  inputRef.current?.focus();
                }}
                aria-label="Limpar seleção"
              >
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            ) : null}
            <button
              type="button"
              tabIndex={-1}
              className="pointer-events-auto rounded p-0.5 hover:bg-muted"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenSafe(!open)}
              aria-label={open ? "Fechar lista" : "Abrir lista"}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin opacity-50" />
              ) : (
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              )}
            </button>
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] p-0",
          contentClassName,
        )}
        onWheel={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
        onFocusOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        {tabs && tabs.length > 0 ? (
          <div className="flex gap-1 border-b border-border p-1">
            {tabs.map((row) => {
              const active = row.value === activeTab;
              return (
                <button
                  key={row.value}
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    if (tab == null) setInternalTab(row.value);
                    onTabChange?.(row.value);
                    inputRef.current?.focus();
                  }}
                >
                  {row.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {searchHint ? (
          <p className="border-b border-border px-2 py-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
            {searchHint}
          </p>
        ) : null}
        <div
          ref={listRef}
          className={cn(
            "overflow-y-auto overscroll-contain p-1",
            listMaxHeightClassName,
          )}
          onScroll={() => {
            const el = listRef.current;
            if (el) onListScroll?.(el);
          }}
        >
          {leadingOptions.map(renderRow)}
          {loading && filtered.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {loadingMessage}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          ) : (
            <>
              {loading ? (
                <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {loadingMessage}
                </p>
              ) : null}
              {filtered.map((option, index) => {
                const prev = filtered[index - 1];
                const showGroup =
                  Boolean(option.group) && option.group !== prev?.group;
                return (
                  <div key={option.value}>
                    {showGroup ? (
                      <p className="px-2 pt-2 pb-1 text-xs font-semibold text-pretty text-foreground">
                        {option.group}
                      </p>
                    ) : null}
                    {renderRow(option)}
                  </div>
                );
              })}
            </>
          )}
        </div>
        {createOption || trailingOptions.length > 0 ? (
          <div className="border-t border-border bg-muted/50 p-1">
            {createOption ? renderRow(createOption) : null}
            {trailingOptions.map(renderRow)}
          </div>
        ) : null}
        {footer ? (
          <div className="border-t border-border p-2">{footer}</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

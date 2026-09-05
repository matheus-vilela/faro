import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { ChevronDown, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

const TAG_PALETTE = [
  "border-sky-300/70 bg-sky-500/10 text-sky-950 dark:border-sky-600/50 dark:bg-sky-500/[0.14] dark:text-sky-50",
  "border-violet-300/70 bg-violet-500/10 text-violet-950 dark:border-violet-600/50 dark:bg-violet-500/[0.14] dark:text-violet-50",
  "border-emerald-300/70 bg-emerald-500/10 text-emerald-950 dark:border-emerald-600/50 dark:bg-emerald-500/[0.14] dark:text-emerald-50",
  "border-amber-300/80 bg-amber-500/12 text-amber-950 dark:border-amber-600/50 dark:bg-amber-500/[0.15] dark:text-amber-50",
  "border-rose-300/70 bg-rose-500/10 text-rose-950 dark:border-rose-600/50 dark:bg-rose-500/[0.14] dark:text-rose-50",
  "border-cyan-300/70 bg-cyan-500/10 text-cyan-950 dark:border-cyan-600/50 dark:bg-cyan-500/[0.14] dark:text-cyan-50",
] as const;

function tagClassAt(i: number) {
  return TAG_PALETTE[i % TAG_PALETTE.length];
}

interface ProductCategoryTagsFieldProps {
  companyId: string;
  categories: CompanyProductCategory[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCategoriesChange: () => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** Bloco mais baixo, para tabelas / onboarding. */
  compact?: boolean;
  placeholder?: string;
}

export function ProductCategoryTagsField({
  companyId,
  categories,
  selectedIds,
  onChange,
  onCategoriesChange,
  disabled,
  label,
  hint,
  compact = false,
  placeholder = "Grupo",
}: ProductCategoryTagsFieldProps) {
  const resolvedLabel =
    label === undefined ? "Categorias de produto" : label;
  const resolvedHint =
    hint === undefined
      ? "Adicione quantas quiser. Busque, selecione ou crie uma nova categoria. Categorias marcadas como não-venda não entram em vendas nem na correlação."
      : hint;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const selectedOrdered = useMemo(() => {
    return selectedIds
      .map((id) => byId.get(id))
      .filter((c): c is CompanyProductCategory => c != null)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [selectedIds, byId]);

  const q = query.trim().toLowerCase();
  const available = useMemo(() => {
    const sel = new Set(selectedIds);
    return categories
      .filter((c) => !sel.has(c.id))
      .filter((c) =>
        q ? c.name.toLowerCase().normalize("NFD").includes(q.normalize("NFD")) : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [categories, selectedIds, q]);

  const canCreate = useMemo(() => {
    const t = query.trim();
    if (!t) return false;
    const n = t.toLowerCase();
    return !categories.some((c) => c.name.trim().toLowerCase() === n);
  }, [query, categories]);

  const addId = (id: string) => {
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
    setQuery("");
  };

  const removeId = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  const createCategory = async () => {
    const name = query.trim();
    if (!name || creating || disabled) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("company_product_categories")
      .insert({
        company_id: companyId,
        name,
        sort_order: 9999,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      console.error(error);
      return;
    }
    onCategoriesChange();
    if (data?.id) addId(data.id as string);
    setOpen(false);
    setQuery("");
  };

  const pickerContent = (
    <PopoverContent
      className={
        compact
          ? "z-[200] flex max-h-[min(22rem,70vh)] w-[min(28rem,max(22rem,var(--radix-popover-trigger-width)),calc(100vw-1.5rem))] min-w-[min(22rem,calc(100vw-1.5rem))] max-w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0"
          : "z-[200] flex max-h-[min(22rem,70vh)] w-[min(100vw-2rem,22rem)] flex-col gap-0 overflow-hidden p-0"
      }
      align="start"
      sideOffset={6}
      collisionPadding={16}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="shrink-0 border-b border-border p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ou digitar nome novo…"
          className={cn(compact ? "h-8 text-sm" : "h-10")}
          disabled={creating}
        />
      </div>
      <div
        className="min-h-0 max-h-60 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-1 [-webkit-overflow-scrolling:touch]"
        onWheel={(e) => e.stopPropagation()}
      >
        {available.length === 0 && !canCreate ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            {q
              ? "Nada encontrado — crie uma nova abaixo."
              : "Todas as categorias já foram adicionadas."}
          </p>
        ) : (
          available.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                addId(c.id);
                setOpen(false);
              }}
            >
              <span>{c.name}</span>
              {c.exclude_from_sales ? (
                <span className="shrink-0 text-[11px] text-amber-800 dark:text-amber-200">
                  Não é venda
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
      {canCreate ? (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={creating}
            onClick={() => void createCategory()}
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Criar &quot;{query.trim()}&quot;
          </Button>
        </div>
      ) : null}
    </PopoverContent>
  );

  if (compact) {
    const first = selectedOrdered[0];
    const extra = selectedOrdered.length - 1;
    const allNames = selectedOrdered.map((c) => c.name).join(", ");
    const trigger = (
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between gap-1 px-2 font-normal"
        disabled={disabled}
      >
        {selectedOrdered.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
            {placeholder}
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {first ? (
              <span
                title={
                  first.exclude_from_sales
                    ? "Não aparece como venda"
                    : undefined
                }
                className={cn(
                  "inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                  first.exclude_from_sales
                    ? "border-amber-500/50 bg-amber-500/12 text-amber-950 dark:text-amber-50"
                    : tagClassAt(0),
                )}
              >
                <span className="truncate">{first.name}</span>
                <span
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!disabled) removeId(first.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!disabled) removeId(first.id);
                    }
                  }}
                  aria-label={`Remover ${first.name}`}
                >
                  <X className="h-3 w-3 shrink-0 opacity-70" />
                </span>
              </span>
            ) : null}
            {extra > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    +{extra}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  {allNames}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        )}
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    );

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {pickerContent}
      </Popover>
    );
  }

  return (
    <div className="space-y-2">
      {resolvedLabel.trim() ? <Label>{resolvedLabel}</Label> : null}
      <div
        className={cn(
          "min-h-[3rem] rounded-2xl border border-border bg-background px-3 py-2.5 shadow-sm transition-colors",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {selectedOrdered.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Nenhuma categoria — use o campo abaixo para adicionar.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedOrdered.map((c, idx) => (
              <span
                key={c.id}
                title={
                  c.exclude_from_sales
                    ? "Não aparece como venda"
                    : undefined
                }
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm",
                  c.exclude_from_sales
                    ? "border-amber-500/50 bg-amber-500/12 text-amber-950 dark:text-amber-50"
                    : tagClassAt(idx),
                )}
              >
                <span className="truncate">{c.name}</span>
                {c.exclude_from_sales ? (
                  <span className="shrink-0 text-[10px] font-normal opacity-80">
                    não venda
                  </span>
                ) : null}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeId(c.id);
                  }}
                  aria-label={`Remover ${c.name}`}
                >
                  <X className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-between rounded-xl border-dashed font-normal text-muted-foreground hover:text-foreground"
            disabled={disabled}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Adicionar categoria…
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        {pickerContent}
      </Popover>

      {resolvedHint.trim() ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {resolvedHint}
        </p>
      ) : null}
    </div>
  );
}

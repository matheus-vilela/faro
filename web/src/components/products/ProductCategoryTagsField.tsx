import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { X } from "lucide-react";
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
      ? "Adicione quantas quiser. Busque, selecione ou crie uma nova categoria. Categorias marcadas como não-venda não entram em vendas nem em classificar."
      : hint;
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

  const available = useMemo(() => {
    const sel = new Set(selectedIds);
    return categories
      .filter((c) => c.ativo !== false)
      .filter((c) => !sel.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [categories, selectedIds]);

  const addId = (id: string) => {
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
  };

  const removeId = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  const createCategory = async (rawName: string) => {
    const name = rawName.trim();
    if (!name || creating || disabled) return;
    const exists = categories.some(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (exists) return;
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
  };

  const selector = (
    <SearchSelect
      value=""
      onValueChange={addId}
      options={available.map((c) => ({
        value: c.id,
        label: c.name,
        description: c.exclude_from_sales ? "Não é venda" : undefined,
      }))}
      placeholder={
        compact
          ? selectedOrdered.length === 0
            ? placeholder
            : "Adicionar categoria…"
          : "Adicionar categoria…"
      }
      searchPlaceholder="Buscar ou digitar nome novo…"
      emptyMessage={
        available.length === 0
          ? "Todas as categorias já foram adicionadas."
          : "Nada encontrado — cadastre o texto digitado."
      }
      disabled={disabled || creating}
      size={compact ? "sm" : "default"}
      triggerClassName={
        compact ? undefined : "h-11 rounded-xl border-dashed"
      }
      onCreate={(query) => void createCategory(query)}
      createLabel={(query) => `Criar «${query}»`}
      loading={creating}
      loadingMessage="Criando…"
    />
  );

  if (compact) {
    const first = selectedOrdered[0];
    const extra = selectedOrdered.length - 1;
    const allNames = selectedOrdered.map((c) => c.name).join(", ");
    return (
      <div className="space-y-1.5">
        {selectedOrdered.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
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
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) removeId(first.id);
                  }}
                  aria-label={`Remover ${first.name}`}
                >
                  <X className="h-3 w-3 shrink-0 opacity-70" />
                </button>
              </span>
            ) : null}
            {extra > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    +{extra}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  {allNames}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        {selector}
      </div>
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
                  onClick={() => removeId(c.id)}
                  aria-label={`Remover ${c.name}`}
                >
                  <X className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {selector}

      {resolvedHint.trim() ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {resolvedHint}
        </p>
      ) : null}
    </div>
  );
}

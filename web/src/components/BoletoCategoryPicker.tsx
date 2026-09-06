import { Button } from "@/components/ui/button";
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
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
} from "@/components/ui/search-select";
import {
  buildChildrenMap,
  categoryPathLabel,
  companyCategoryDisplayName,
  isLeafCategory,
  isSelectableDespesaLeaf,
  isSelectableReceitaLeaf,
  NATUREZA_LABEL,
  TIPO_LABEL,
} from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory, TipoCategoria } from "@/types/category";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const CREATE_VALUE = "__boleto_category_create__";

function buildLeafOptions(
  categories: CompanyCategory[],
  byId: Map<string, CompanyCategory>,
  isSelectableLeaf: (c: CompanyCategory) => boolean,
): {
  id: string;
  leafLabel: string;
  parentId: string | null;
  parentLabel: string;
  haystack: string;
}[] {
  const childrenMap = buildChildrenMap(categories);
  const leaves = categories.filter(
    (c) => isSelectableLeaf(c) && isLeafCategory(c.id, childrenMap),
  );
  leaves.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return companyCategoryDisplayName(a).localeCompare(
      companyCategoryDisplayName(b),
      "pt-BR",
    );
  });
  return leaves.map((c) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const parentLabel = parent ? categoryPathLabel(parent.id, byId) : "Raiz";
    const leafLabel = companyCategoryDisplayName(c);
    const fullPath = categoryPathLabel(c.id, byId);
    return {
      id: c.id,
      leafLabel,
      parentId: parent?.id ?? null,
      parentLabel,
      haystack: `${parentLabel} ${leafLabel} ${fullPath}`,
    };
  });
}

export function BoletoCategoryPicker({
  companyId,
  value,
  onValueChange,
  categories,
  loading,
  onReload,
  disabled,
  categoryNatureza = "DESPESA",
  excludeTipos,
  compact = false,
  allowClear = false,
  placeholder,
}: {
  companyId: string;
  value: string;
  onValueChange: (id: string) => void;
  categories: CompanyCategory[];
  loading: boolean;
  onReload: () => void | Promise<void>;
  disabled?: boolean;
  /** Natureza das categorias listadas e criadas neste picker. */
  categoryNatureza?: "DESPESA" | "RECEITA";
  /** Tipos omitidos da lista (ex.: esconder um grupo específico). */
  excludeTipos?: TipoCategoria[];
  compact?: boolean;
  allowClear?: boolean;
  placeholder?: string;
}) {
  const excluded = new Set(excludeTipos ?? []);
  const isSelectableLeaf = (c: CompanyCategory) => {
    const byNatureza =
      categoryNatureza === "RECEITA"
        ? isSelectableReceitaLeaf(c)
        : isSelectableDespesaLeaf(c);
    if (!byNatureza) return false;
    if (excluded.has(c.tipo)) return false;
    return true;
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [creating, setCreating] = useState(false);

  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const parentOptions = useMemo(() => {
    const list = categories.filter(
      (c) =>
        c.natureza === categoryNatureza &&
        c.ativo !== false &&
        !excluded.has(c.tipo),
    );
    list.sort((a, b) =>
      categoryPathLabel(a.id, byId).localeCompare(
        categoryPathLabel(b.id, byId),
        "pt-BR",
      ),
    );
    return list;
  }, [categories, byId, categoryNatureza, excludeTipos]);

  const tipoParent = useMemo(
    () => new Map(parentOptions.map((p) => [p.id, p.tipo])),
    [parentOptions],
  );

  const parentById = useMemo(
    () => new Map(parentOptions.map((p) => [p.id, p])),
    [parentOptions],
  );

  useEffect(() => {
    if (parentOptions.length && !parentOptions.some((g) => g.id === newParentId)) {
      setNewParentId(parentOptions[0]!.id);
    }
  }, [parentOptions, newParentId]);

  const options = useMemo(
    () => buildLeafOptions(categories, byId, isSelectableLeaf),
    [categories, byId, isSelectableLeaf],
  );

  const selectedCategory = value ? byId.get(value) : undefined;
  const selectedLabel = selectedCategory
    ? companyCategoryDisplayName(selectedCategory)
    : "";
  const triggerDisabled = Boolean(disabled) || loading;

  const openCreate = (prefill = "") => {
    if (parentOptions.length === 0) {
      toast.error(
        categoryNatureza === "RECEITA"
          ? "Não há categorias de receita ativas disponíveis."
          : "Não há categorias de despesa ativas disponíveis.",
      );
      return;
    }
    setNewName(prefill.trim());
    setNewParentId(parentOptions[0]!.id);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    if (!newParentId) {
      toast.error("Selecione o grupo onde a categoria ficará.");
      return;
    }
    setCreating(true);
    const inheritedTipo = (tipoParent.get(newParentId) ??
      (categoryNatureza === "RECEITA" ? "OPERACIONAL" : "VARIAVEL")) as TipoCategoria;
    const { data, error } = await supabase
      .from("company_categories")
      .insert({
        company_id: companyId,
        parent_id: newParentId,
        name,
        sort_order: 0,
        ordem: 0,
        natureza: categoryNatureza,
        tipo: inheritedTipo,
        padrao_sistema: false,
        incluir_no_dre: true,
        ativo: true,
      })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      categoryNatureza === "RECEITA"
        ? "Categoria de receita criada."
        : "Categoria de despesa criada.",
    );
    await onReload();
    onValueChange((data as CompanyCategory).id);
    setCreateOpen(false);
    setNewName("");
  };

  const naturezaLabel = categoryNatureza === "RECEITA" ? "receita" : "despesa";

  return (
    <>
      <SearchSelect
        value={value}
        onValueChange={(next) => {
          if (next === CREATE_VALUE) {
            openCreate();
            return;
          }
          onValueChange(next);
        }}
        options={options.map((o) => ({
          value: o.id,
          label: o.leafLabel,
          group: o.parentLabel,
          keywords: o.haystack,
        }))}
        placeholder={
          loading
            ? "Carregando…"
            : placeholder ||
              (categoryNatureza === "RECEITA"
                ? "Selecione uma categoria de receita"
                : "Selecione uma categoria de despesa")
        }
        triggerLabel={selectedLabel || undefined}
        searchPlaceholder="Buscar categoria…"
        emptyMessage={
          options.length === 0
            ? "Nenhuma categoria elegível. Use Configurações ou cadastre abaixo."
            : "Nenhum resultado para esta busca."
        }
        disabled={triggerDisabled}
        size={compact ? "sm" : "default"}
        triggerClassName={compact ? "text-xs" : undefined}
        contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
        listMaxHeightClassName="max-h-[min(240px,40vh)]"
        clearable={allowClear}
        onCreate={(query) => openCreate(query)}
        createLabel={(query) => `Cadastrar «${query}»`}
        trailingOptions={[
          {
            value: CREATE_VALUE,
            label: `Nova subcategoria (${naturezaLabel})`,
            description: "Cadastrar categoria",
            accent: true,
          },
        ]}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="z-[120] sm:max-w-lg"
          overlayClassName="z-[115]"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>
              Nova categoria de{" "}
              {categoryNatureza === "RECEITA" ? "receita" : "despesa"}
            </DialogTitle>
            <DialogDescription>
              A categoria será criada como subcategoria da categoria pai escolhida.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="boleto-new-cat-name">Nome</Label>
              <Input
                id="boleto-new-cat-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Material de limpeza"
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria pai</Label>
              <SearchSelect
                value={newParentId}
                onValueChange={setNewParentId}
                options={parentOptions.map((p) => {
                  const parent = p.parent_id ? parentById.get(p.parent_id) : null;
                  return {
                    value: p.id,
                    label: companyCategoryDisplayName(p),
                    group: parent
                      ? categoryPathLabel(parent.id, byId)
                      : "Raiz",
                    description: `${NATUREZA_LABEL[p.natureza]} · ${TIPO_LABEL[p.tipo]}`,
                    keywords: categoryPathLabel(p.id, byId),
                  };
                })}
                placeholder="Selecione"
                searchPlaceholder="Buscar pai…"
                disabled={creating || parentOptions.length === 0}
                contentClassName="z-[130]"
                triggerLabel={
                  newParentId
                    ? `${categoryPathLabel(newParentId, byId)} (${NATUREZA_LABEL[parentById.get(newParentId)?.natureza ?? "DESPESA"]} · ${TIPO_LABEL[parentById.get(newParentId)?.tipo ?? "VARIAVEL"]})`
                    : undefined
                }
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={submitCreate} disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Criar e usar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

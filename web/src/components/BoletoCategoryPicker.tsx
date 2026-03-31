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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildChildrenMap,
  categoryPathLabel,
  isLeafCategory,
  isSelectableDespesaLeaf,
  NATUREZA_LABEL,
  TIPO_LABEL,
} from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory, TipoCategoria } from "@/types/category";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function buildLeafOptions(
  categories: CompanyCategory[],
  byId: Map<string, CompanyCategory>,
): {
  id: string;
  leafLabel: string;
  parentId: string | null;
  parentLabel: string;
  haystack: string;
}[] {
  const childrenMap = buildChildrenMap(categories);
  const leaves = categories.filter(
    (c) => isSelectableDespesaLeaf(c) && isLeafCategory(c.id, childrenMap),
  );
  leaves.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(
      b.name,
      "pt-BR",
    );
  });
  return leaves.map((c) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const parentLabel = parent ? categoryPathLabel(parent.id, byId) : "Raiz";
    const leafLabel = c.name;
    const fullPath = categoryPathLabel(c.id, byId);
    return {
      id: c.id,
      leafLabel,
      parentId: parent?.id ?? null,
      parentLabel,
      haystack: normalizeSearch(`${parentLabel} ${leafLabel} ${fullPath}`),
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
}: {
  companyId: string;
  value: string;
  onValueChange: (id: string) => void;
  categories: CompanyCategory[];
  loading: boolean;
  onReload: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const parentOptions = useMemo(() => {
    const list = categories.filter(
      (c) => c.natureza === "DESPESA" && c.ativo !== false,
    );
    list.sort((a, b) =>
      categoryPathLabel(a.id, byId).localeCompare(
        categoryPathLabel(b.id, byId),
        "pt-BR",
      ),
    );
    return list;
  }, [categories, byId]);

  const tipoParent = useMemo(
    () => new Map(parentOptions.map((p) => [p.id, p.tipo])),
    [parentOptions],
  );

  const parentById = useMemo(
    () => new Map(parentOptions.map((p) => [p.id, p])),
    [parentOptions],
  );

  const parentFiltered = useMemo(() => {
    const q = normalizeSearch(parentSearch);
    if (!q) return parentOptions;
    return parentOptions.filter((p) =>
      normalizeSearch(categoryPathLabel(p.id, byId)).includes(q),
    );
  }, [parentOptions, parentSearch, byId]);

  const parentGrouped = useMemo(() => {
    const groups = new Map<string, { label: string; items: CompanyCategory[] }>();
    for (const item of parentFiltered) {
      const key = item.parent_id ?? "__root__";
      const parent = item.parent_id ? parentById.get(item.parent_id) : null;
      const label = parent ? categoryPathLabel(parent.id, byId) : "Raiz";
      const existing = groups.get(key);
      if (existing) existing.items.push(item);
      else groups.set(key, { label, items: [item] });
    }
    return [...groups.entries()]
      .map(([key, value]) => ({
        key,
        label: value.label,
        items: value.items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [parentFiltered, parentById, byId]);

  useEffect(() => {
    if (parentOptions.length && !parentOptions.some((g) => g.id === newParentId)) {
      setNewParentId(parentOptions[0]!.id);
    }
  }, [parentOptions, newParentId]);

  const options = useMemo(
    () => buildLeafOptions(categories, byId),
    [categories, byId],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return options;
    return options.filter(
      (o) =>
        o.haystack.includes(q) ||
        o.leafLabel.toLowerCase().includes(search.toLowerCase().trim()) ||
        o.parentLabel.toLowerCase().includes(search.toLowerCase().trim()),
    );
  }, [options, search]);

  const groupedFiltered = useMemo(() => {
    const groups = new Map<
      string,
      { parentLabel: string; items: typeof filtered }
    >();

    for (const opt of filtered) {
      const key = opt.parentId ?? "__root__";
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(opt);
      } else {
        groups.set(key, {
          parentLabel: opt.parentLabel,
          items: [opt],
        });
      }
    }

    return [...groups.entries()]
      .map(([key, value]) => ({
        key,
        parentLabel: value.parentLabel,
        items: value.items.sort((a, b) =>
          a.leafLabel.localeCompare(b.leafLabel, "pt-BR"),
        ),
      }))
      .sort((a, b) => a.parentLabel.localeCompare(b.parentLabel, "pt-BR"));
  }, [filtered]);

  const selectedLabel = value ? byId.get(value)?.name ?? "" : "";
  const triggerDisabled = Boolean(disabled) || loading;

  const openCreate = () => {
    if (parentOptions.length === 0) {
      toast.error(
        "Não há categorias de despesa ativas disponíveis.",
      );
      return;
    }
    setNewName(search.trim() || "");
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
    const inheritedTipo = (tipoParent.get(newParentId) ?? "VARIAVEL") as TipoCategoria;
    const { data, error } = await supabase
      .from("company_categories")
      .insert({
        company_id: companyId,
        parent_id: newParentId,
        name,
        sort_order: 0,
        ordem: 0,
        natureza: "DESPESA",
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
    toast.success("Categoria de despesa criada.");
    await onReload();
    onValueChange((data as CompanyCategory).id);
    setCreateOpen(false);
    setOpen(false);
    setSearch("");
    setNewName("");
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={triggerDisabled}
            className={cn(
              "w-full justify-between font-normal h-9 px-3",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate text-left">
              {loading
                ? "Carregando…"
                : selectedLabel || "Selecione uma categoria de despesa"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-2 border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar categoria…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
                autoFocus
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full gap-1.5"
              onClick={openCreate}
              disabled={parentOptions.length === 0}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Nova subcategoria (despesa)
            </Button>
          </div>
          <div
            className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-contain p-1"
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {options.length === 0
                  ? "Nenhuma categoria elegível. Use Configurações ou crie acima."
                  : "Nenhum resultado para esta busca."}
              </p>
            ) : (
              groupedFiltered.map((group) => (
                <div key={group.key} className="px-1 py-1">
                  <p className="px-2 text-xs font-semibold text-foreground">
                    {group.parentLabel}
                  </p>
                  <div className="relative mt-1 ml-2 pl-4 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-border">
                    {group.items.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onValueChange(opt.id);
                          setOpen(false);
                          setSearch("");
                        }}
                        className={cn(
                          "relative flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                          value === opt.id && "bg-accent",
                        )}
                      >
                        <span className="absolute -left-1 top-1/2 h-px w-3 -translate-y-1/2 bg-border" />
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            value === opt.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {opt.leafLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="z-[120] sm:max-w-md"
          overlayClassName="z-[115]"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>Nova categoria de despesa</DialogTitle>
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
              <Popover open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={creating || parentOptions.length === 0}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate text-left">
                      {newParentId
                        ? `${categoryPathLabel(newParentId, byId)} (${NATUREZA_LABEL[parentById.get(newParentId)?.natureza ?? "DESPESA"]} · ${TIPO_LABEL[parentById.get(newParentId)?.tipo ?? "VARIAVEL"]})`
                        : "Selecione"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[130] w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
                  align="start"
                  onWheel={(e) => e.stopPropagation()}
                >
                  <div className="border-b p-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Buscar pai..."
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                        className="h-9 pl-8"
                      />
                    </div>
                  </div>
                  <div
                    className="max-h-[240px] overflow-y-auto overscroll-contain p-1"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    {parentGrouped.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                        Nenhum resultado.
                      </p>
                    ) : (
                      parentGrouped.map((group) => (
                        <div key={group.key} className="px-1 py-1">
                          <p className="px-2 text-xs font-semibold text-foreground">
                            {group.label}
                          </p>
                          <div className="relative mt-1 ml-2 pl-4 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-border">
                            {group.items.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setNewParentId(opt.id);
                                  setParentPickerOpen(false);
                                  setParentSearch("");
                                }}
                                className={cn(
                                  "relative flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                                  newParentId === opt.id && "bg-accent",
                                )}
                              >
                                <span className="absolute -left-1 top-1/2 h-px w-3 -translate-y-1/2 bg-border" />
                                <Check className={cn("h-4 w-4 shrink-0", newParentId === opt.id ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{opt.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
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

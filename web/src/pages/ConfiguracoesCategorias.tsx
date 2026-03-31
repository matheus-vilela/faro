import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { buildChildrenMap, categoryPathLabel, NATUREZA_LABEL, TIPO_LABEL } from "@/lib/companyCategoryLabels";
import { canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory, NaturezaCategoria, TipoCategoria } from "@/types/category";
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, FolderTree, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const TIPOS_RECEITA: TipoCategoria[] = ["OPERACIONAL", "NAO_OPERACIONAL"];
const TIPOS_DESPESA: TipoCategoria[] = [
  "CMV",
  "VARIAVEL",
  "FIXA",
  "IMPOSTOS",
  "INVESTIMENTOS_FINANCIAMENTOS",
];

export function ConfiguracoesCategorias() {
  const { currentCompany, currentRole } = useCompany();
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false;
  const [rows, setRows] = useState<CompanyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formNatureza, setFormNatureza] = useState<NaturezaCategoria>("DESPESA");
  const [formTipo, setFormTipo] = useState<TipoCategoria>("VARIAVEL");
  const [formParentId, setFormParentId] = useState<string>("ROOT");
  const [formOrdem, setFormOrdem] = useState("0");
  const [formAtivo, setFormAtivo] = useState(true);
  const [formDre, setFormDre] = useState(true);
  const [editing, setEditing] = useState<CompanyCategory | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [formKind, setFormKind] = useState<"principal" | "subcategoria" | "edicao">("principal");
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");

  const load = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("ordem", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar categorias: " + error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as CompanyCategory[]);
    }
    setLoading(false);
  }, [currentCompany?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const childrenMap = useMemo(() => buildChildrenMap(rows), [rows]);
  const roots = useMemo(
    () => rows.filter((r) => r.parent_id === null).sort((a, b) => (a.ordem ?? a.sort_order ?? 0) - (b.ordem ?? b.sort_order ?? 0)),
    [rows],
  );
  const rootsReceitas = useMemo(
    () => roots.filter((r) => r.natureza === "RECEITA"),
    [roots],
  );
  const rootsDespesas = useMemo(
    () => roots.filter((r) => r.natureza === "DESPESA"),
    [roots],
  );

  const allDescendants = useCallback(
    (id: string): Set<string> => {
      const result = new Set<string>();
      const walk = (nodeId: string) => {
        const ch = childrenMap.get(nodeId) ?? [];
        for (const c of ch) {
          if (result.has(c.id)) continue;
          result.add(c.id);
          walk(c.id);
        }
      };
      walk(id);
      return result;
    },
    [childrenMap],
  );

  const parentOptions = useMemo(() => {
    const blocked = editing ? allDescendants(editing.id) : new Set<string>();
    if (editing) blocked.add(editing.id);
    return rows.filter((r) => !blocked.has(r.id));
  }, [rows, editing, allDescendants]);

  const filteredParentOptions = useMemo(() => {
    const base = parentOptions.filter((p) => p.natureza === formNatureza);
    const q = parentSearch
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();
    if (!q) return base;
    return base.filter((p) =>
      categoryPathLabel(p.id, byId)
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .includes(q),
    );
  }, [parentOptions, formNatureza, parentSearch, byId]);

  const parentGrouped = useMemo(() => {
    const mapById = new Map(filteredParentOptions.map((p) => [p.id, p]));
    const groups = new Map<string, { label: string; items: CompanyCategory[] }>();
    for (const item of filteredParentOptions) {
      const key = item.parent_id ?? "__root__";
      const parent = item.parent_id ? mapById.get(item.parent_id) ?? byId.get(item.parent_id) : null;
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
  }, [filteredParentOptions, byId]);

  const resetForm = () => {
    setEditing(null);
    setSelectedId(null);
    setFormKind("principal");
    setFormName("");
    setFormNatureza("DESPESA");
    setFormTipo("VARIAVEL");
    setFormParentId("ROOT");
    setFormOrdem("0");
    setFormAtivo(true);
    setFormDre(true);
  };

  const openCreateRoot = () => {
    resetForm();
    setFormKind("principal");
    setSheetOpen(true);
  };

  const openCreateChild = (parent: CompanyCategory) => {
    setEditing(null);
    setFormKind("subcategoria");
    setSelectedId(parent.id);
    setFormName("");
    setFormNatureza(parent.natureza);
    setFormTipo(parent.tipo);
    setFormParentId(parent.id);
    setFormOrdem("0");
    setFormAtivo(true);
    setFormDre(true);
    setSheetOpen(true);
  };

  const openEdit = (row: CompanyCategory) => {
    setEditing(row);
    setFormKind("edicao");
    setSelectedId(row.id);
    setFormName(row.name);
    setFormNatureza(row.natureza);
    setFormTipo(row.tipo);
    setFormParentId(row.parent_id ?? "ROOT");
    setFormOrdem(String(row.ordem ?? row.sort_order ?? 0));
    setFormAtivo(row.ativo !== false);
    setFormDre(row.incluir_no_dre !== false);
    setSheetOpen(true);
  };

  const validTipos = formNatureza === "RECEITA" ? TIPOS_RECEITA : TIPOS_DESPESA;
  const canSelectPrincipalAsParent =
    formKind === "principal" || (formKind === "edicao" && editing?.parent_id === null);
  useEffect(() => {
    if (!validTipos.includes(formTipo)) {
      setFormTipo(validTipos[0]);
    }
  }, [formNatureza, formTipo, validTipos]);

  const save = async () => {
    if (!currentCompany?.id || !isOwner) return;
    const name = formName.trim();
    if (!name) {
      toast.error("Informe o nome.");
      return;
    }
    if (formKind === "subcategoria" && formParentId === "ROOT") {
      toast.error("Subcategoria deve estar vinculada a uma categoria principal ou outra subcategoria.");
      return;
    }
    const ordem = Number.parseInt(formOrdem, 10);
    const payload = {
      company_id: currentCompany.id,
      name,
      natureza: formNatureza,
      tipo: formTipo,
      parent_id: formKind === "principal" ? null : formParentId === "ROOT" ? null : formParentId,
      ordem: Number.isFinite(ordem) ? ordem : 0,
      sort_order: Number.isFinite(ordem) ? ordem : 0,
      ativo: formAtivo,
      incluir_no_dre: formDre,
      padrao_sistema: editing?.padrao_sistema ?? false,
    };
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("company_categories")
        .update(payload)
        .eq("id", editing.id)
        .eq("company_id", currentCompany.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Categoria atualizada.");
    } else {
      const { error } = await supabase.from("company_categories").insert(payload);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Categoria criada.");
    }
    resetForm();
    setSheetOpen(false);
    await load();
  };

  const archive = async (row: CompanyCategory) => {
    if (!currentCompany?.id || !isOwner) return;
    const { error } = await supabase
      .from("company_categories")
      .update({ ativo: false })
      .eq("id", row.id)
      .eq("company_id", currentCompany.id);
    if (error) return toast.error(error.message);
    toast.success("Categoria arquivada.");
    await load();
  };

  const remove = async (row: CompanyCategory) => {
    if (!currentCompany?.id || !isOwner) return;
    const { error } = await supabase
      .from("company_categories")
      .delete()
      .eq("id", row.id)
      .eq("company_id", currentCompany.id);
    if (error) return toast.error(error.message);
    toast.success("Categoria removida.");
    if (selectedId === row.id) {
      resetForm();
      setSheetOpen(false);
    }
    await load();
  };

  const renderNode = (node: CompanyCategory, depth: number) => {
    const children = childrenMap.get(node.id) ?? [];
    const isOpen = expanded[node.id] ?? true;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60",
            selectedId === node.id && "bg-muted",
            node.ativo === false && "opacity-60",
          )}
          style={{ marginLeft: depth * 14 }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((s) => ({ ...s, [node.id]: !isOpen }))}
              className="rounded p-0.5 hover:bg-muted"
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => openEdit(node)}
          >
            <p className="truncate text-sm font-medium">{node.name}</p>
          </button>
          <Badge variant="outline" className="text-[10px]">{NATUREZA_LABEL[node.natureza]}</Badge>
          <Badge variant="secondary" className="text-[10px]">{TIPO_LABEL[node.tipo]}</Badge>
          {node.padrao_sistema ? <Badge className="text-[10px]">Padrão</Badge> : null}
          {node.ativo === false ? <Badge variant="destructive" className="text-[10px]">Inativa</Badge> : null}
          {isOwner ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => openCreateChild(node)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => archive(node)}>
                Arquivar
              </Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(node)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
        {isOpen ? children.map((c) => renderNode(c, depth + 1)) : null}
      </div>
    );
  };

  return (
    <PageShell className="space-y-6">
      <PageHeader
        icon={FolderTree}
        title="Categorias financeiras"
        description="Mantenha sua estrutura financeira clara e fácil de usar. Crie categorias principais e, quando fizer sentido, adicione subcategorias para detalhar melhor seus lançamentos."
        action={
          <Button onClick={openCreateRoot} disabled={!isOwner || loading}>
            <Plus className="mr-1 h-4 w-4" />
            Nova categoria principal
          </Button>
        }
      />

      <div className="grid gap-4">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Receitas</CardTitle>
            <CardDescription>Expanda ou recolha para navegar entre categorias principais e subcategorias de receita.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando...
              </p>
            ) : rootsReceitas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma categoria de receita cadastrada.</p>
            ) : (
              <div className="space-y-1">{rootsReceitas.map((r) => renderNode(r, 0))}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Despesas</CardTitle>
            <CardDescription>Expanda ou recolha para navegar entre categorias principais e subcategorias de despesa.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando...
              </p>
            ) : rootsDespesas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma categoria de despesa cadastrada.</p>
            ) : (
              <div className="space-y-1">{rootsDespesas.map((r) => renderNode(r, 0))}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={sheetOpen} onOpenChange={(o) => !saving && setSheetOpen(o)}>
        <SheetContent className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar categoria" : formKind === "subcategoria" ? "Nova subcategoria" : "Nova categoria principal"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Edite nome, natureza, tipo, categoria principal/subcategoria e status."
                : formKind === "subcategoria"
                  ? "Crie uma subcategoria dentro de uma categoria principal ou de outra subcategoria."
                  : "Crie uma categoria principal. Depois, se desejar, adicione subcategorias."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} disabled={saving} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Natureza</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormNatureza("RECEITA")}
                    disabled={saving}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      formNatureza === "RECEITA"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <p className="font-medium">Receitas</p>
                    <p className="text-xs text-muted-foreground">Entradas e receitas operacionais/não operacionais</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormNatureza("DESPESA")}
                    disabled={saving}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      formNatureza === "DESPESA"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <p className="font-medium">Despesas</p>
                    <p className="text-xs text-muted-foreground">CMV, variáveis, fixas, impostos e investimentos</p>
                  </button>
                </div>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Tipo ({formNatureza === "RECEITA" ? "Receita" : "Despesa"})</Label>
                <Select
                  value={formTipo}
                  onValueChange={(v) => setFormTipo(v as TipoCategoria)}
                  disabled={saving}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(formNatureza === "RECEITA" ? TIPOS_RECEITA : TIPOS_DESPESA).map((t) => (
                      <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{formKind === "principal" ? "Categoria principal" : "Subcategoria de"}</Label>
              {formKind === "principal" ? (
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  Esta categoria será criada como categoria principal.
                </div>
              ) : (
                <Popover open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                      disabled={saving}
                    >
                      <span className="truncate text-left">
                        {formParentId === "ROOT"
                          ? "Categoria principal"
                          : formParentId
                            ? categoryPathLabel(formParentId, byId)
                            : "Selecione"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
                    <div className="border-b p-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Buscar categoria principal ou subcategoria..."
                          value={parentSearch}
                          onChange={(e) => setParentSearch(e.target.value)}
                          className="h-9 pl-8"
                          disabled={saving}
                        />
                      </div>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto p-1">
                      {canSelectPrincipalAsParent ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFormParentId("ROOT");
                            setParentPickerOpen(false);
                            setParentSearch("");
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                            formParentId === "ROOT" && "bg-accent",
                          )}
                        >
                          <Check className={cn("h-4 w-4", formParentId === "ROOT" ? "opacity-100" : "opacity-0")} />
                          Categoria principal
                        </button>
                      ) : null}
                      {parentGrouped.map((group) => (
                        <div key={group.key} className="px-1 py-1">
                          <p className="px-2 text-xs font-semibold text-foreground">
                            {group.label === "Raiz" ? "Categorias principais" : group.label}
                          </p>
                          <div className="relative mt-1 ml-2 pl-4 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-border">
                            {group.items.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setFormParentId(opt.id);
                                  setParentPickerOpen(false);
                                  setParentSearch("");
                                }}
                                className={cn(
                                  "relative flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                                  formParentId === opt.id && "bg-accent",
                                )}
                              >
                                <span className="absolute -left-1 top-1/2 h-px w-3 -translate-y-1/2 bg-border" />
                                <Check className={cn("h-4 w-4", formParentId === opt.id ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{opt.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="space-y-2">
              <Label>Ordem</Label>
              <Input type="number" value={formOrdem} onChange={(e) => setFormOrdem(e.target.value)} disabled={saving} />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>Ativa</Label>
              <Switch checked={formAtivo} onCheckedChange={setFormAtivo} disabled={saving} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>Incluir no DRE</Label>
              <Switch checked={formDre} onCheckedChange={setFormDre} disabled={saving} />
            </div>
          </div>

          <SheetFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { resetForm(); setSheetOpen(false); }} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || !isOwner}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Salvar" : "Criar")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

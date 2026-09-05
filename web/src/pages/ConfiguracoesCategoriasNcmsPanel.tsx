import { ProductCatalogCategoryPicker } from "@/components/ProductCatalogCategoryPicker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  filterCompanyNcms,
  similarUnmappedNcms,
  unmappedCount,
} from "@/lib/ncm/companyNcms";
import {
  deleteNcmCategoryRules,
  fetchCompanyNcmProducts,
  fetchCompanyNcms,
  upsertNcmCategoryRules,
} from "@/lib/ncm/ncmCategoryRulesApi";
import {
  formatNcmDisplay,
  ncmChapter4,
  normalizeNcm8,
} from "@/lib/ncm/normalizeNcm";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import type {
  CompanyNcmListFilter,
  CompanyNcmProductRow,
  CompanyNcmRow,
} from "@/types/companyNcmCategory";
import { Barcode, Loader2, Plus, Search, Tags, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type SortKey = "ncm" | "examples" | "products" | "notes" | "category" | "dre";

function compareNcmRows(
  a: CompanyNcmRow,
  b: CompanyNcmRow,
  key: SortKey,
  categoryLabel: (id: string | null) => string,
  dreLabel: (row: CompanyNcmRow) => string,
): number {
  if (key === "ncm") return a.ncm.localeCompare(b.ncm);
  if (key === "examples") {
    return a.sampleProductNames
      .join(" ")
      .localeCompare(b.sampleProductNames.join(" "), "pt-BR");
  }
  if (key === "products") return a.productCount - b.productCount;
  if (key === "notes") return a.expenseItemCount - b.expenseItemCount;
  if (key === "dre") {
    return dreLabel(a).localeCompare(dreLabel(b), "pt-BR");
  }
  return categoryLabel(a.categoryId).localeCompare(
    categoryLabel(b.categoryId),
    "pt-BR",
  );
}

export function ConfiguracoesCategoriasNcmsPanel({
  companyId,
  isOwner,
}: {
  companyId: string;
  isOwner: boolean;
}) {
  const listView = useSheetListView();
  const [rows, setRows] = useState<CompanyNcmRow[]>([]);
  const [productCategories, setProductCategories] = useState<
    CompanyProductCategory[]
  >([]);
  const [dreCategories, setDreCategories] = useState<CompanyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingNcm, setSavingNcm] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CompanyNcmListFilter>("unmapped");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [similar, setSimilar] = useState<{
    ncm: string;
    categoryId: string;
    chapter: string;
  } | null>(null);
  const [similarSaving, setSimilarSaving] = useState(false);
  const [sheetNcm, setSheetNcm] = useState<string | null>(null);
  const [sheetProducts, setSheetProducts] = useState<CompanyNcmProductRow[]>(
    [],
  );
  const [sheetLoading, setSheetLoading] = useState(false);
  const compareSheet = useCallback(
    (
      a: CompanyNcmProductRow,
      b: CompanyNcmProductRow,
      key: "name" | "unit",
    ) => {
      if (key === "unit") {
        return String(a.unit ?? "").localeCompare(String(b.unit ?? ""), "pt-BR");
      }
      return a.name.localeCompare(b.name, "pt-BR");
    },
    [],
  );
  const sheetSort = useClientTableSort<CompanyNcmProductRow, "name" | "unit">(
    sheetProducts,
    "name",
    compareSheet,
    true,
  );
  const [addNcm, setAddNcm] = useState("");
  const [addCategoryId, setAddCategoryId] = useState("");
  const [adding, setAdding] = useState(false);

  const loadCategories = useCallback(async () => {
    const [prodRes, dreRes] = await Promise.all([
      supabase
        .from("company_product_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    if (prodRes.error) {
      toast.error("Erro ao carregar categorias de produto: " + prodRes.error.message);
      setProductCategories([]);
    } else {
      setProductCategories((prodRes.data ?? []) as CompanyProductCategory[]);
    }
    if (dreRes.error) {
      toast.error("Erro ao carregar contas do DRE: " + dreRes.error.message);
      setDreCategories([]);
    } else {
      setDreCategories((dreRes.data ?? []) as CompanyCategory[]);
    }
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ncmRows] = await Promise.all([
        fetchCompanyNcms(companyId),
        loadCategories(),
      ]);
      setRows(ncmRows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar NCMs.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, loadCategories]);

  useEffect(() => {
    void load();
  }, [load]);

  const productCategoryById = useMemo(
    () => new Map(productCategories.map((c) => [c.id, c])),
    [productCategories],
  );
  const dreById = useMemo(
    () => new Map(dreCategories.map((c) => [c.id, c])),
    [dreCategories],
  );
  const categoryLabel = useCallback(
    (id: string | null) => {
      if (!id) return "";
      return productCategoryById.get(id)?.name ?? "";
    },
    [productCategoryById],
  );
  const dreLabel = useCallback(
    (row: CompanyNcmRow) => {
      const dreId =
        row.dreCategoryId ||
        productCategoryById.get(row.categoryId ?? "")?.default_dre_category_id ||
        null;
      if (!dreId) return "Definir na aba de produtos";
      return dreById.get(dreId)?.name ?? "Definir na aba de produtos";
    },
    [dreById, productCategoryById],
  );

  const pending = unmappedCount(rows);
  const filtered = useMemo(
    () => filterCompanyNcms(rows, filter, query),
    [rows, filter, query],
  );
  const compare = useCallback(
    (a: CompanyNcmRow, b: CompanyNcmRow, key: SortKey) =>
      compareNcmRows(a, b, key, categoryLabel, dreLabel),
    [categoryLabel, dreLabel],
  );
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    CompanyNcmRow,
    SortKey
  >(filtered, "ncm", compare, true);

  const similarRows = useMemo(
    () => (similar ? similarUnmappedNcms(rows, similar.ncm) : []),
    [rows, similar],
  );

  const allPageSelected =
    sorted.length > 0 && sorted.every((r) => selected.has(r.ncm));

  const assign = async (
    ncms: string[],
    categoryId: string | null,
    opts?: { similarFrom?: string },
  ) => {
    if (!isOwner || ncms.length === 0) return;
    const key = ncms.length === 1 ? ncms[0]! : "bulk";
    setSavingNcm(key);
    try {
      if (categoryId) {
        await upsertNcmCategoryRules({ companyId, ncms, categoryId });
      } else {
        await deleteNcmCategoryRules({ companyId, ncms });
      }
      await load();
      if (categoryId && opts?.similarFrom) {
        const chapter = ncmChapter4(opts.similarFrom);
        if (chapter) {
          setSimilar({ ncm: opts.similarFrom, categoryId, chapter });
        }
      } else {
        setSimilar(null);
      }
      toast.success(
        categoryId
          ? ncms.length > 1
            ? `${ncms.length} NCMs vinculados.`
            : "NCM vinculado à categoria."
          : "Vínculo removido.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSavingNcm(null);
    }
  };

  const openSheet = async (ncm: string) => {
    setSheetNcm(ncm);
    setSheetLoading(true);
    try {
      setSheetProducts(await fetchCompanyNcmProducts(companyId, ncm));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao listar produtos.");
      setSheetProducts([]);
    } finally {
      setSheetLoading(false);
    }
  };

  const addManual = async () => {
    const ncm = normalizeNcm8(addNcm);
    if (!ncm || !addCategoryId || !isOwner) return;
    setAdding(true);
    try {
      await upsertNcmCategoryRules({
        companyId,
        ncms: [ncm],
        categoryId: addCategoryId,
      });
      setAddNcm("");
      setAddCategoryId("");
      await load();
      toast.success("NCM adicionado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível adicionar.",
      );
    } finally {
      setAdding(false);
    }
  };

  const applyBulk = async () => {
    if (!bulkCategoryId || selected.size === 0) return;
    setBulkSaving(true);
    try {
      await assign([...selected], bulkCategoryId);
      setSelected(new Set());
      setBulkCategoryId("");
    } finally {
      setBulkSaving(false);
    }
  };

  const applySimilar = async () => {
    if (!similar || similarRows.length === 0) return;
    setSimilarSaving(true);
    try {
      await assign(
        similarRows.map((r) => r.ncm),
        similar.categoryId,
      );
      setSimilar(null);
    } finally {
      setSimilarSaving(false);
    }
  };

  const filterChip = (id: CompanyNcmListFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(id)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        filter === id
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  const picker = (row: CompanyNcmRow) => (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ProductCatalogCategoryPicker
        value={row.categoryId ?? ""}
        onValueChange={(id) => {
          void assign([row.ncm], id || null, id ? { similarFrom: row.ncm } : {});
        }}
        categories={productCategories}
        disabled={!isOwner || savingNcm === row.ncm}
        compact
        allowClear={Boolean(row.categoryId)}
        placeholder="Sem categoria"
      />
    </div>
  );

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Barcode className="h-5 w-5" />
          NCMs
        </CardTitle>
        <CardDescription>
          O NCM define a categoria do produto; a linha da nota usa a Conta do DRE
          dessa categoria.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-muted-foreground">
            {pending === 0
              ? "Todos os NCMs já têm categoria."
              : `${pending} NCM${pending === 1 ? "" : "s"} ainda sem categoria.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {filterChip("unmapped", "Sem categoria")}
            {filterChip("all", "Todos")}
            {filterChip("mapped", "Com categoria")}
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por NCM ou nome de produto"
            className="pl-9"
          />
        </div>

        {similar && similarRows.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Aplicar aos parecidos (mesmo início {similar.chapter})?{" "}
              <span className="text-muted-foreground">
                {similarRows.length} NCM
                {similarRows.length === 1 ? "" : "s"} ainda sem categoria.
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSimilar(null)}
              >
                Agora não
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!isOwner || similarSaving}
                onClick={() => void applySimilar()}
              >
                {similarSaving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Aplicar
              </Button>
            </div>
          </div>
        ) : null}

        {selected.size > 0 ? (
          <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.07] p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold">
                  {selected.size} NCM{selected.size === 1 ? "" : "s"}{" "}
                  selecionado{selected.size === 1 ? "" : "s"}
                </p>
                <ProductCatalogCategoryPicker
                  value={bulkCategoryId}
                  onValueChange={setBulkCategoryId}
                  categories={productCategories}
                  disabled={!isOwner}
                  placeholder="Categoria para os selecionados"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Limpar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!isOwner || !bulkCategoryId || bulkSaving}
                  onClick={() => void applyBulk()}
                >
                  {bulkSaving ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Tags className="mr-1 h-3.5 w-3.5" />
                  )}
                  Vincular
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Os códigos aparecem sozinhos quando você importar a primeira NF-e.
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum NCM neste filtro.
          </p>
        ) : listView === "cards" ? (
          <ul className="grid gap-2">
            {sorted.map((row) => (
              <li
                key={row.ncm}
                className="rounded-xl border border-border/80 bg-muted/20 p-3"
              >
                <div className="flex items-start gap-2">
                  {isOwner ? (
                    <Checkbox
                      checked={selected.has(row.ncm)}
                      onCheckedChange={(on) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(row.ncm);
                          else next.delete(row.ncm);
                          return next;
                        });
                      }}
                      aria-label={`Selecionar ${formatNcmDisplay(row.ncm)}`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void openSheet(row.ncm)}
                  >
                    <p className="font-medium tabular-nums">
                      {formatNcmDisplay(row.ncm)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.sampleProductNames.length > 0
                        ? row.sampleProductNames.join(", ")
                        : "Sem exemplos de produto"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {row.productCount} produto
                      {row.productCount === 1 ? "" : "s"} ·{" "}
                      {row.expenseItemCount} linha
                      {row.expenseItemCount === 1 ? "" : "s"} de NF
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Conta do DRE: {dreLabel(row)}
                    </p>
                  </button>
                </div>
                <div className="mt-2">{picker(row)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <th className="w-10 px-3 py-2.5">
                    {isOwner ? (
                      <Checkbox
                        checked={allPageSelected}
                        onCheckedChange={(on) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const row of sorted) {
                              if (on) next.add(row.ncm);
                              else next.delete(row.ncm);
                            }
                            return next;
                          });
                        }}
                        aria-label="Selecionar todos"
                      />
                    ) : null}
                  </th>
                  <SortableTableHead
                    label="NCM"
                    column="ncm"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Exemplos"
                    column="examples"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Produtos"
                    column="products"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableTableHead
                    label="Linhas de NF"
                    column="notes"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableTableHead
                    label="Categoria"
                    column="category"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Conta do DRE"
                    column="dre"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.ncm}
                    className="border-b border-border/70 last:border-0"
                  >
                    <td className="px-3 py-2">
                      {isOwner ? (
                        <Checkbox
                          checked={selected.has(row.ncm)}
                          onCheckedChange={(on) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(row.ncm);
                              else next.delete(row.ncm);
                              return next;
                            });
                          }}
                          aria-label={`Selecionar ${formatNcmDisplay(row.ncm)}`}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium tabular-nums hover:underline"
                        onClick={() => void openSheet(row.ncm)}
                      >
                        {formatNcmDisplay(row.ncm)}
                      </button>
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-muted-foreground">
                      <button
                        type="button"
                        className="text-left hover:text-foreground"
                        onClick={() => void openSheet(row.ncm)}
                      >
                        {row.sampleProductNames.length > 0
                          ? row.sampleProductNames.join(", ")
                          : "—"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.productCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.expenseItemCount}
                    </td>
                    <td className="min-w-[220px] px-3 py-2">{picker(row)}</td>
                    <td className="min-w-[160px] px-3 py-2 text-muted-foreground">
                      {dreLabel(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isOwner ? (
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="add-ncm">Adicionar NCM</Label>
              <Input
                id="add-ncm"
                value={addNcm}
                onChange={(e) => setAddNcm(e.target.value)}
                placeholder="22021000"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria de produto</Label>
              <ProductCatalogCategoryPicker
                value={addCategoryId}
                onValueChange={setAddCategoryId}
                categories={productCategories}
                placeholder="Categoria de produto"
              />
            </div>
            <Button
              type="button"
              disabled={adding || !normalizeNcm8(addNcm) || !addCategoryId}
              onClick={() => void addManual()}
            >
              {adding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Adicionar
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Apenas o proprietário pode vincular NCMs a categorias.
          </p>
        )}
      </CardContent>

      <Sheet
        open={Boolean(sheetNcm)}
        onOpenChange={(o) => !o && setSheetNcm(null)}
      >
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>
              Produtos com NCM {sheetNcm ? formatNcmDisplay(sheetNcm) : ""}
            </SheetTitle>
            <SheetDescription>
              Consulta dos produtos cadastrados com este código. A categoria de
              produto vale para o NCM; a Conta do DRE vem dessa categoria.
            </SheetDescription>
          </SheetHeader>
          {sheetLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </p>
          ) : sheetProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto cadastrado com este NCM.
            </p>
          ) : listView === "cards" ? (
            <ul className="grid gap-2">
              {sheetSort.sorted.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-border/80 px-3 py-2.5 text-sm"
                >
                  <p className="font-medium">{p.name}</p>
                  {p.unit ? (
                    <p className="text-xs text-muted-foreground">{p.unit}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <SortableTableHead
                      label="Produto"
                      column="name"
                      sortKey={sheetSort.sortKey}
                      sortAsc={sheetSort.sortAsc}
                      onSort={sheetSort.onSort}
                    />
                    <SortableTableHead
                      label="Unidade"
                      column="unit"
                      sortKey={sheetSort.sortKey}
                      sortAsc={sheetSort.sortAsc}
                      onSort={sheetSort.onSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sheetSort.sorted.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border/70 last:border-0"
                    >
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.unit ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

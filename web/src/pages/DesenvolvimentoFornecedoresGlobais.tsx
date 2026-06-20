import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDebounce } from "@/hooks/useDebounce";
import { formatXmlForDisplay } from "@/lib/formatXmlForDisplay";
import { maskCpfCnpj } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  FileCode2,
  FlaskConical,
  Loader2,
  Search,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

type UnifiedSupplier = {
  id: string;
  tax_document: string;
  name: string;
  fantasy_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  sighting_count: number;
};

type UnifiedSupplierProduct = {
  id: string;
  unified_supplier_id: string;
  c_prod: string;
  product_name: string;
  ean: string | null;
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  unit_commercial: string | null;
  min_price: number | null;
  max_price: number | null;
  min_price_chave_nfe: string | null;
  max_price_chave_nfe: string | null;
  min_price_nfe_xml: string | null;
  max_price_nfe_xml: string | null;
  xml_prod: Record<string, unknown>;
  sighting_count: number;
  last_seen_at: string;
};

type NfeXmlSheetState = {
  title: string;
  chaveNfe: string | null;
  xml: string;
};

type ProductHistoryRow = {
  id: string;
  previous_product_name: string | null;
  new_product_name: string;
  previous_ean: string | null;
  new_ean: string | null;
  chave_nfe: string | null;
  observed_at: string;
};

function formatDoc(doc: string): string {
  return maskCpfCnpj(doc.replace(/\D/g, ""));
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function formatMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

export function DesenvolvimentoFornecedoresGlobais() {
  const [suppliers, setSuppliers] = useState<UnifiedSupplier[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [loading, setLoading] = useState(true);

  const [selectedSupplier, setSelectedSupplier] =
    useState<UnifiedSupplier | null>(null);
  const [products, setProducts] = useState<UnifiedSupplierProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebounce(productSearch, 300);

  const [historyProduct, setHistoryProduct] =
    useState<UnifiedSupplierProduct | null>(null);
  const [historyRows, setHistoryRows] = useState<ProductHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [nfeXmlSheet, setNfeXmlSheet] = useState<NfeXmlSheetState | null>(null);

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("unified_suppliers")
      .select("*", { count: "exact" })
      .order("last_seen_at", { ascending: false })
      .range(from, to);

    const term = debouncedSearch.trim();
    if (term) {
      const digits = term.replace(/\D/g, "");
      if (digits.length >= 3) {
        query = query.or(
          `name.ilike.%${term}%,fantasy_name.ilike.%${term}%,tax_document.ilike.%${digits}%`,
        );
      } else {
        query = query.or(`name.ilike.%${term}%,fantasy_name.ilike.%${term}%`);
      }
    }

    const { data, error, count: total } = await query;
    if (error) {
      console.error("[unified_suppliers]", error.message);
      setSuppliers([]);
      setCount(0);
    } else {
      setSuppliers((data ?? []) as UnifiedSupplier[]);
      setCount(total ?? 0);
    }
    setLoading(false);
  }, [page, debouncedSearch]);

  useEffect(() => {
    void fetchSuppliers();
  }, [fetchSuppliers]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const fetchProducts = useCallback(async () => {
    if (!selectedSupplier) return;
    setProductsLoading(true);

    let query = supabase
      .from("unified_supplier_products")
      .select("*")
      .eq("unified_supplier_id", selectedSupplier.id)
      .order("last_seen_at", { ascending: false })
      .limit(500);

    const term = debouncedProductSearch.trim();
    if (term) {
      query = query.or(
        `product_name.ilike.%${term}%,c_prod.ilike.%${term}%,ean.ilike.%${term}%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error("[unified_supplier_products]", error.message);
      setProducts([]);
    } else {
      setProducts((data ?? []) as UnifiedSupplierProduct[]);
    }
    setProductsLoading(false);
  }, [selectedSupplier, debouncedProductSearch]);

  useEffect(() => {
    if (selectedSupplier) void fetchProducts();
  }, [fetchProducts, selectedSupplier]);

  const openHistory = useCallback(async (product: UnifiedSupplierProduct) => {
    setHistoryProduct(product);
    setHistoryLoading(true);
    setHistoryRows([]);
    const { data, error } = await supabase
      .from("unified_supplier_product_description_history")
      .select("*")
      .eq("unified_supplier_product_id", product.id)
      .order("observed_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error(
        "[unified_supplier_product_description_history]",
        error.message,
      );
    } else {
      setHistoryRows((data ?? []) as ProductHistoryRow[]);
    }
    setHistoryLoading(false);
  }, []);

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Fornecedores globais"
        description="Catálogo global de fornecedores (CPF/CNPJ + cProd). Menor e maior preço unitário efetivo e XML da NF-e de cada extremo, no ecossistema Faro."
        icon={FlaskConical}
        action={
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <Link to="/app/desenvolvimento">
              <ArrowLeft className="h-4 w-4" />
              Desenvolvimento
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2 max-w-md">
          <Label htmlFor="unified-supplier-search">Buscar fornecedor</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="unified-supplier-search"
              placeholder="Nome, fantasia ou CNPJ/CPF"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {count} fornecedor{count === 1 ? "" : "es"} no catálogo global
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum fornecedor global ainda. Execute o sync NF-e (com XML) em
            Desenvolvimento → Sync NFs.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelectedSupplier(s);
                setProductSearch("");
              }}
              className={cn(
                "flex w-full items-center gap-4 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Truck className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {formatDoc(s.tax_document)}
                  {s.fantasy_name ? ` · ${s.fantasy_name}` : ""}
                </p>
              </div>
              <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground shrink-0">
                <span>{s.sighting_count} NF-e(s)</span>
                <span>Última: {formatDateTime(s.last_seen_at)}</span>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={count}
            onPageChange={setPage}
          />
        </div>
      )}

      <Sheet
        open={selectedSupplier != null}
        onOpenChange={(open) => {
          if (!open) setSelectedSupplier(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col sm:max-w-5xl overflow-y-auto"
        >
          {selectedSupplier ? (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">
                  {selectedSupplier.name}
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {formatDoc(selectedSupplier.tax_document)}
                  {selectedSupplier.fantasy_name
                    ? ` · ${selectedSupplier.fantasy_name}`
                    : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-2 px-1">
                <Label htmlFor="unified-product-search">Buscar produto</Label>
                <Input
                  id="unified-product-search"
                  placeholder="cProd, nome ou EAN"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>

              {productsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : products.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1">
                  Nenhum produto com cProd para este fornecedor.
                </p>
              ) : (
                <div className="space-y-2 px-1 pb-6 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {products.length} produto(s) · menor/maior preço unitário
                    efetivo (global)
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full caption-bottom border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left">
                          <th className="p-2 font-medium">Produto</th>
                          <th className="p-2 font-medium font-mono text-xs">
                            cProd
                          </th>
                          <th className="p-2 font-medium hidden md:table-cell">
                            EAN
                          </th>
                          <th className="p-2 font-medium hidden lg:table-cell">
                            NCM
                          </th>
                          <th className="p-2 font-medium">Un.</th>
                          <th className="p-2 text-right font-medium">
                            Menor preço
                          </th>
                          <th className="p-2 text-right font-medium">
                            Maior preço
                          </th>
                          <th className="p-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((p) => (
                          <tr
                            key={p.id}
                            className="border-b border-border/60 align-top hover:bg-muted/30"
                          >
                            <td className="max-w-[200px] p-2">
                              <span
                                className="line-clamp-2 font-medium leading-snug"
                                title={p.product_name}
                              >
                                {p.product_name}
                              </span>
                            </td>
                            <td className="p-2 font-mono text-xs whitespace-nowrap">
                              {p.c_prod}
                            </td>
                            <td className="p-2 font-mono text-xs hidden md:table-cell">
                              {p.ean ?? "—"}
                            </td>
                            <td className="p-2 font-mono text-xs hidden lg:table-cell">
                              {p.ncm ?? "—"}
                            </td>
                            <td className="p-2 font-mono text-xs whitespace-nowrap">
                              {p.unit_commercial ?? "—"}
                            </td>
                            <td className="p-2 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                              <span className="inline-flex items-center justify-end gap-0.5">
                                {formatMoney(p.min_price)}
                                {p.min_price_nfe_xml?.trim() ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Ver XML da NF-e (menor preço)"
                                    onClick={() =>
                                      setNfeXmlSheet({
                                        title: "NF-e — menor preço",
                                        chaveNfe: p.min_price_chave_nfe,
                                        xml: formatXmlForDisplay(
                                          p.min_price_nfe_xml!,
                                        ),
                                      })
                                    }
                                  >
                                    <FileCode2 className="h-3.5 w-3.5" />
                                    <span className="sr-only">
                                      XML menor preço
                                    </span>
                                  </Button>
                                ) : null}
                              </span>
                            </td>
                            <td className="p-2 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                              <span className="inline-flex items-center justify-end gap-0.5">
                                {formatMoney(p.max_price)}
                                {p.max_price_nfe_xml?.trim() ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Ver XML da NF-e (maior preço)"
                                    onClick={() =>
                                      setNfeXmlSheet({
                                        title: "NF-e — maior preço",
                                        chaveNfe: p.max_price_chave_nfe,
                                        xml: formatXmlForDisplay(
                                          p.max_price_nfe_xml!,
                                        ),
                                      })
                                    }
                                  >
                                    <FileCode2 className="h-3.5 w-3.5" />
                                    <span className="sr-only">
                                      XML maior preço
                                    </span>
                                  </Button>
                                ) : null}
                              </span>
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => void openHistory(p)}
                              >
                                Histórico
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={nfeXmlSheet != null}
        onOpenChange={(open) => {
          if (!open) setNfeXmlSheet(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col sm:max-w-3xl"
        >
          <SheetHeader>
            <SheetTitle>{nfeXmlSheet?.title ?? "XML da NF-e"}</SheetTitle>
            <SheetDescription className="font-mono text-xs break-all">
              {nfeXmlSheet?.chaveNfe
                ? `Chave ${nfeXmlSheet.chaveNfe}`
                : "Sem chave gravada"}
            </SheetDescription>
          </SheetHeader>
          <pre className="flex-1 min-h-0 overflow-auto rounded-md border bg-muted/40 p-4 text-[11px] leading-relaxed font-mono whitespace-pre text-foreground/90">
            {nfeXmlSheet?.xml ?? ""}
          </pre>
        </SheetContent>
      </Sheet>

      <Sheet
        open={historyProduct != null}
        onOpenChange={(open) => {
          if (!open) setHistoryProduct(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Histórico de alterações</SheetTitle>
            <SheetDescription>
              {historyProduct
                ? `${historyProduct.product_name} (cProd ${historyProduct.c_prod})`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : historyRows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 pb-4">
              Sem registros de mudança de EAN/nome.
            </p>
          ) : (
            <ul className="space-y-3 px-4 pb-6">
              {historyRows.map((h) => (
                <li
                  key={h.id}
                  className="rounded-md border px-3 py-2 text-sm space-y-1"
                >
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(h.observed_at)}
                    {h.chave_nfe ? (
                      <span className="ml-2 font-mono">
                        NF {h.chave_nfe.slice(-8)}
                      </span>
                    ) : null}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Nome:</span>{" "}
                    {h.previous_product_name ?? "—"} → {h.new_product_name}
                  </p>
                  <p className="font-mono text-xs">
                    EAN: {h.previous_ean ?? "—"} → {h.new_ean ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

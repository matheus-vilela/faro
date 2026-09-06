import { SearchSelect } from "@/components/ui/search-select";
import { supabasePublic } from "@/lib/supabasePublic";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 30;
const NEW_VALUE = "__new__";
const NONE_VALUE = "__none__";

type CatalogRow = { id: string; name: string };

export type ProductSelectPickResult =
  | { kind: "new" }
  | { kind: "none" }
  | { kind: "product"; productId: string; productName: string };

type ProductSelectPopoverProps = {
  token: string;
  /** Valor atual: `__new__`, `__none__` ou UUID do produto. */
  selectVal: string;
  catalogProductName: string | null | undefined;
  onPick: (r: ProductSelectPickResult) => void;
  id?: string;
};

async function fetchPage(
  token: string,
  query: string,
  offset: number,
): Promise<CatalogRow[]> {
  const { data, error } = await supabasePublic.rpc(
    "search_products_for_whatsapp_draft",
    {
      p_token: token,
      p_query: query,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    },
  );
  if (error) {
    console.error(error);
    return [];
  }
  const list = Array.isArray(data) ? data : [];
  return list.filter(
    (r): r is CatalogRow =>
      r &&
      typeof (r as CatalogRow).id === "string" &&
      typeof (r as CatalogRow).name === "string",
  );
}

export function ProductSelectPopover({
  token,
  selectVal,
  catalogProductName,
  onPick,
  id,
}: ProductSelectPopoverProps) {
  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const skipSearchDebounceRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const primedRef = useRef(false);

  const reloadFromStart = useCallback(
    async (q: string) => {
      setLoading(true);
      setHasMore(true);
      const rows = await fetchPage(token, q, 0);
      setItems(rows);
      setHasMore(rows.length >= PAGE_SIZE);
      setLoading(false);
    },
    [token],
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore || loadMoreInFlightRef.current)
      return;
    loadMoreInFlightRef.current = true;
    const q = searchInput.trim();
    setLoadingMore(true);
    const rows = await fetchPage(token, q, items.length);
    setItems((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const merged = [...prev];
      for (const r of rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          merged.push(r);
        }
      }
      return merged;
    });
    setHasMore(rows.length >= PAGE_SIZE);
    setLoadingMore(false);
    loadMoreInFlightRef.current = false;
  }, [hasMore, loading, loadingMore, searchInput, token, items]);

  useEffect(() => {
    if (primedRef.current) return;
    primedRef.current = true;
    skipSearchDebounceRef.current = true;
    void reloadFromStart("");
  }, [reloadFromStart]);

  useEffect(() => {
    if (skipSearchDebounceRef.current) {
      skipSearchDebounceRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void reloadFromStart(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, reloadFromStart]);

  const triggerText = (() => {
    if (selectVal === NEW_VALUE) return "+ Criar produto novo";
    if (selectVal === NONE_VALUE)
      return "— Escolher depois (obrigatório antes de salvar)";
    if (catalogProductName) return catalogProductName;
    return "Produto no Faro";
  })();

  const selectedInList = items.some((p) => p.id === selectVal);
  const selectedOption =
    catalogProductName &&
    selectVal &&
    selectVal !== NEW_VALUE &&
    selectVal !== NONE_VALUE &&
    !selectedInList
      ? [{ value: selectVal, label: catalogProductName }]
      : [];

  return (
    <SearchSelect
      id={id}
      value={selectVal}
      onValueChange={(next) => {
        if (next === NEW_VALUE) {
          onPick({ kind: "new" });
          return;
        }
        if (next === NONE_VALUE) {
          onPick({ kind: "none" });
          return;
        }
        const name =
          items.find((p) => p.id === next)?.name ??
          catalogProductName ??
          next;
        onPick({ kind: "product", productId: next, productName: name });
      }}
      options={[
        ...selectedOption,
        ...items.map((p) => ({ value: p.id, label: p.name })),
      ]}
      leadingOptions={[
        {
          value: NEW_VALUE,
          label: "+ Criar produto novo",
          accent: true,
        },
      ]}
      trailingOptions={[
        {
          value: NONE_VALUE,
          label: "— Escolher depois (obrigatório antes de salvar)",
        },
      ]}
      placeholder="Produto no Faro"
      triggerLabel={triggerText}
      searchPlaceholder="Buscar produto…"
      searchHint="Digite para filtrar ou role a lista para carregar mais."
      emptyMessage="Nenhum produto encontrado."
      loading={loading || loadingMore}
      loadingMessage={loadingMore ? "Carregando mais…" : "Carregando…"}
      filterLocally={false}
      onSearchChange={setSearchInput}
      onListScroll={(el) => {
        const threshold = 72;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
          void loadMore();
        }
      }}
      triggerClassName="h-auto min-h-10 max-w-full gap-2 py-2 text-left whitespace-normal"
    />
  );
}

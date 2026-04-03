import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabasePublic } from "@/lib/supabasePublic";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Loader2, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const PAGE_SIZE = 30;

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
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const skipSearchDebounceRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);

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
    if (!hasMore || loading || loadingMore || loadMoreInFlightRef.current) return;
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

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      skipSearchDebounceRef.current = true;
      setSearchInput("");
      void reloadFromStart("");
    }
  };

  useEffect(() => {
    if (!open) return;
    if (skipSearchDebounceRef.current) {
      skipSearchDebounceRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void reloadFromStart(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, open, reloadFromStart]);

  const onScrollList = () => {
    const el = listRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    const threshold = 72;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      void loadMore();
    }
  };

  const triggerText = (() => {
    if (selectVal === "__new__") return "+ Criar produto novo";
    if (selectVal === "__none__")
      return "— Escolher depois (obrigatório antes de salvar)";
    if (catalogProductName) return catalogProductName;
    return "Produto no Faro";
  })();

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          id={id}
          className={cn(
            "h-auto min-h-10 w-full max-w-full justify-between gap-2 py-2 font-normal",
            "text-left whitespace-normal",
          )}
        >
          <span className="min-w-0 flex-1 wrap-break-word text-left leading-snug">
            {triggerText}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "z-50 w-[min(100vw-2rem,var(--radix-popover-trigger-width))] max-w-[min(100vw-2rem,28rem)] p-0",
          "origin-(--radix-popover-content-transform-origin)",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar produto…"
                className="h-9 pl-8"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
              Digite para filtrar ou role a lista para carregar mais.
            </p>
          </div>

          <div
            ref={listRef}
            onScroll={onScrollList}
            className="max-h-[min(50vh,280px)] overflow-y-auto overscroll-contain p-1"
          >
            <button
              type="button"
              className={cn(
                "flex w-full rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors",
                "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                selectVal === "__new__" && "bg-accent/80",
              )}
              onClick={() => {
                onPick({ kind: "new" });
                setOpen(false);
              }}
            >
              + Criar produto novo
            </button>

            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Carregando…
              </div>
            ) : items.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </p>
            ) : (
              items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn(
                    "flex w-full rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    selectVal === p.id && "bg-accent/80",
                  )}
                  onClick={() => {
                    onPick({
                      kind: "product",
                      productId: p.id,
                      productName: p.name,
                    });
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 wrap-break-word leading-snug">
                    {p.name}
                  </span>
                </button>
              ))
            )}

            {loadingMore && (
              <div className="flex justify-center py-2">
                <Loader2
                  className="h-4 w-4 animate-spin text-muted-foreground"
                  aria-hidden
                />
              </div>
            )}

            <button
              type="button"
              className={cn(
                "mt-0.5 flex w-full rounded-sm px-2 py-2 text-left text-sm text-muted-foreground outline-none transition-colors",
                "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                selectVal === "__none__" && "bg-accent/80 text-foreground",
              )}
              onClick={() => {
                onPick({ kind: "none" });
                setOpen(false);
              }}
            >
              — Escolher depois (obrigatório antes de salvar)
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

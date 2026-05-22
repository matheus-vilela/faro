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
import { useDebounce } from "@/hooks/useDebounce";
import { mergeCompanyProducts } from "@/lib/mergeProducts";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Loader2,
  Package,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ProductMergeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  sourceProduct: Product;
  formatCurrency: (v: number) => string;
  onMerged: (winnerId: string) => void;
};

function productMetaLine(p: Product, formatCurrency: (v: number) => string) {
  const parts: string[] = [
    `${Number(p.current_quantity).toLocaleString("pt-BR")} ${p.unit}`,
  ];
  if (p.ean?.trim()) parts.push(`EAN ${p.ean.trim()}`);
  else if (p.barcode?.trim()) parts.push(`Cód. ${p.barcode.trim()}`);
  if (p.ncm?.trim()) parts.push(`NCM ${p.ncm.trim()}`);
  if (p.last_unit_value != null && !Number.isNaN(Number(p.last_unit_value))) {
    parts.push(`Últ. ${formatCurrency(Number(p.last_unit_value))}`);
  }
  return parts.join(" · ");
}

function ProductMergeCard({
  product,
  formatCurrency,
  variant,
}: {
  product: Product;
  formatCurrency: (v: number) => string;
  variant: "survivor" | "removed";
}) {
  const isSurvivor = variant === "survivor";
  return (
    <div
      className={cn(
        "rounded-xl border-2 p-4 transition-colors",
        isSurvivor
          ? "border-emerald-500/50 bg-emerald-500/8 shadow-sm"
          : "border-destructive/35 bg-destructive/5 opacity-90",
      )}
    >
      <p
        className={cn(
          "text-[0.65rem] font-bold uppercase tracking-wider",
          isSurvivor ? "text-emerald-800 dark:text-emerald-200" : "text-destructive",
        )}
      >
        {isSurvivor ? "Permanece no catálogo" : "Será removido"}
      </p>
      <div className="mt-2 flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
            isSurvivor ? "bg-emerald-500/15 text-emerald-800" : "bg-muted text-muted-foreground",
          )}
        >
          {isSurvivor ? (
            <Check className="h-5 w-5" />
          ) : (
            <Trash2 className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "font-semibold leading-snug",
              !isSurvivor && "line-through decoration-destructive/60",
            )}
          >
            {product.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {productMetaLine(product, formatCurrency)}
          </p>
          {(product.merged_catalog_names?.length ?? 0) > 0 && isSurvivor ? (
            <p className="mt-2 text-[0.65rem] text-muted-foreground">
              Já unificou: {product.merged_catalog_names!.slice(0, 3).join(", ")}
              {product.merged_catalog_names!.length > 3 ? "…" : ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProductMergeDialog({
  open,
  onOpenChange,
  companyId,
  sourceProduct,
  formatCurrency,
  onMerged,
}: ProductMergeDialogProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [partner, setPartner] = useState<Product | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  /** true = produto aberto permanece; false = parceiro permanece (padrão). */
  const [survivorIsSource, setSurvivorIsSource] = useState(false);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const load = async () => {
      setCandidatesLoading(true);
      let q = supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .neq("id", sourceProduct.id)
        .or("is_active.is.null,is_active.eq.true")
        .order("name")
        .limit(50);
      const term = debouncedSearch.trim();
      if (term) {
        const like = `%${term}%`;
        q = q.or(`name.ilike.${like},sku.ilike.${like},ean.ilike.${like},barcode.ilike.${like}`);
      }
      const { data, error } = await q;
      if (cancelled) return;
      setCandidatesLoading(false);
      if (error) {
        console.error(error);
        setCandidates([]);
        return;
      }
      setCandidates((data ?? []) as Product[]);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, companyId, sourceProduct.id, debouncedSearch]);

  useEffect(() => {
    if (!partnerId) {
      setPartner(null);
      return;
    }
    const fromList = candidates.find((p) => p.id === partnerId);
    if (fromList) {
      setPartner(fromList);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("id", partnerId)
        .maybeSingle();
      if (!cancelled && data) setPartner(data as Product);
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId, candidates]);

  const winner = useMemo(
    () => (survivorIsSource ? sourceProduct : partner),
    [survivorIsSource, sourceProduct, partner],
  );
  const loser = useMemo(
    () => (survivorIsSource ? partner : sourceProduct),
    [survivorIsSource, sourceProduct, partner],
  );

  const reset = () => {
    setSearch("");
    setPartnerId(null);
    setPartner(null);
    setCandidates([]);
    setSurvivorIsSource(false);
    setStep("pick");
    setMerging(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!winner || !loser) return;
    setMerging(true);
    const result = await mergeCompanyProducts(companyId, winner.id, loser.id);
    setMerging(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Produtos unificados. «${loser.name}» passou a ser reconhecido como «${winner.name}».`,
    );
    onMerged(result.winnerId);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Unificar produtos</DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? "Escolha o outro cadastro que é o mesmo item. Na etapa seguinte você confirma qual fica no catálogo."
              : "Revise o resultado: estoque, histórico de movimentações e vínculos de notas vão para o produto que permanece."}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">A partir de: </span>
              <span className="font-medium">{sourceProduct.name}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-product-search">Buscar produto</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="merge-product-search"
                  className="pl-9"
                  placeholder="Nome, SKU ou EAN…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div
              className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-1"
              role="listbox"
              aria-label="Produtos para unificar"
            >
              {candidatesLoading ? (
                <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando…
                </p>
              ) : candidates.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum produto encontrado.
                </p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={partnerId === p.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      partnerId === p.id && "bg-primary/10 ring-1 ring-primary/30",
                    )}
                    onClick={() => {
                      setPartnerId(p.id);
                      setPartner(p);
                    }}
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {Number(p.current_quantity).toLocaleString("pt-BR")} {p.unit}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : winner && loser ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <ArrowRight className="h-4 w-4 shrink-0 rotate-90 sm:rotate-0" />
              <span className="text-center text-xs">
                Tudo do produto removido será transferido para o que permanece
              </span>
            </div>
            <ProductMergeCard
              product={winner}
              formatCurrency={formatCurrency}
              variant="survivor"
            />
            <ProductMergeCard
              product={loser}
              formatCurrency={formatCurrency}
              variant="removed"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setSurvivorIsSource((v) => !v)}
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Trocar qual produto permanece
            </Button>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Soma as quantidades em estoque</li>
              <li>Move entradas, saídas e vínculos em despesas / notas</li>
              <li>Guarda o nome removido para a próxima importação automática</li>
              <li>Preenche EAN, NCM e similares no cadastro final se estiverem vazios</li>
            </ul>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "confirm" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("pick")}
              disabled={merging}
            >
              Voltar
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
          )}
          {step === "pick" ? (
            <Button
              type="button"
              disabled={!partnerId}
              onClick={() => setStep("confirm")}
            >
              Continuar
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={merging || !winner || !loser}
              onClick={() => void handleConfirm()}
            >
              {merging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unificando…
                </>
              ) : (
                "Confirmar unificação"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { MergeFactorChoiceList, MergeProductConversionsEditor } from "@/components/products/MergeProductConversionsEditor";
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
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import {
  hasMergedCatalogItems,
  mergedCatalogNameCount,
  mergeSurvivorLock,
} from "@/lib/mergeSurvivorLock";
import { mergeCompanyProducts } from "@/lib/mergeProducts";
import { searchProductsForUnify } from "@/lib/searchProductsForUnify";
import {
  buildMergedUnitConversionsForMerge,
  convertLoserQuantityToWinner,
  draftsToConversionRows,
  listMergeUnitFactorCandidates,
  mergedConversionsToJson,
  resolveMergeUnitFactor,
} from "@/lib/mergeProductUnits";
import {
  loadProductUnitConversions,
} from "@/lib/productUnitConversionsService";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Loader2,
  Package,
  Scale,
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
  /** Pré-seleciona o outro produto (ex.: par sugerido no dashboard). */
  initialPartnerId?: string | null;
  /**
   * Se true, o source permanece no catálogo (ex.: produto vendido/PDV).
   * Default false = partner permanece.
   */
  initialSurvivorIsSource?: boolean;
};

function unitLabel(code: string) {
  const c = code.trim().toLowerCase();
  const label = systemUnitLabel(c);
  return label !== c ? `${label} (${c})` : c;
}

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
  lockReason,
}: {
  product: Product;
  formatCurrency: (v: number) => string;
  variant: "survivor" | "removed";
  lockReason?: string;
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
          {hasMergedCatalogItems(product) ? (
            <p className="mt-2 text-[0.65rem] text-muted-foreground">
              Já unificou {mergedCatalogNameCount(product)}{" "}
              {mergedCatalogNameCount(product) === 1 ? "item" : "itens"}:{" "}
              {product.merged_catalog_names!.slice(0, 3).join(", ")}
              {product.merged_catalog_names!.length > 3 ? "…" : ""}
            </p>
          ) : null}
          {isSurvivor && lockReason ? (
            <p className="mt-2 text-xs leading-snug text-emerald-900 dark:text-emerald-100">
              {lockReason}
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
  initialPartnerId = null,
  initialSurvivorIsSource = false,
}: ProductMergeDialogProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [partner, setPartner] = useState<Product | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [survivorIsSource, setSurvivorIsSource] = useState(
    initialSurvivorIsSource,
  );
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [merging, setMerging] = useState(false);
  const [winnerConversions, setWinnerConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loserConversions, setLoserConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [conversionsLoading, setConversionsLoading] = useState(false);
  const [manualLoserQty, setManualLoserQty] = useState("1");
  const [manualWinnerQty, setManualWinnerQty] = useState("1");
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [factorMode, setFactorMode] = useState<"candidate" | "manual">(
    "candidate",
  );

  useEffect(() => {
    if (!open) return;
    setSurvivorIsSource(initialSurvivorIsSource);
    if (initialPartnerId && initialPartnerId !== sourceProduct.id) {
      setPartnerId(initialPartnerId);
      setStep("confirm");
    }
  }, [open, initialPartnerId, sourceProduct.id, initialSurvivorIsSource]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const load = async () => {
      setCandidatesLoading(true);
      const rows = await searchProductsForUnify({
        companyId,
        excludeId: sourceProduct.id,
        term: debouncedSearch,
        limit: 80,
      });
      if (cancelled) return;
      setCandidatesLoading(false);
      setCandidates(rows);
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

  const survivorLock = useMemo(
    () => mergeSurvivorLock(sourceProduct, partner),
    [sourceProduct, partner],
  );

  useEffect(() => {
    if (!survivorLock.locked) return;
    setSurvivorIsSource(survivorLock.survivor === "source");
  }, [survivorLock]);

  const winner = useMemo(
    () => (survivorIsSource ? sourceProduct : partner),
    [survivorIsSource, sourceProduct, partner],
  );
  const loser = useMemo(
    () => (survivorIsSource ? partner : sourceProduct),
    [survivorIsSource, sourceProduct, partner],
  );

  useEffect(() => {
    if (!open || step !== "confirm" || !winner || !loser) return;
    let cancelled = false;
    void (async () => {
      setConversionsLoading(true);
      const [w, l] = await Promise.all([
        loadProductUnitConversions(companyId, winner.id),
        loadProductUnitConversions(companyId, loser.id),
      ]);
      if (cancelled) return;
      setWinnerConversions(w.rows);
      setLoserConversions(l.rows);
      setConversionsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, companyId, winner?.id, loser?.id]);

  const unitResolution = useMemo(() => {
    if (!winner || !loser) return null;
    return resolveMergeUnitFactor({
      winnerHub: winner.unit,
      winnerConversions: draftsToConversionRows(winnerConversions),
      loserHub: loser.unit,
      loserConversions: draftsToConversionRows(loserConversions),
    });
  }, [winner, loser, winnerConversions, loserConversions]);

  const factorCandidates = useMemo(() => {
    if (!winner || !loser) return [];
    return listMergeUnitFactorCandidates({
      winnerHub: winner.unit,
      winnerConversions: draftsToConversionRows(winnerConversions),
      loserHub: loser.unit,
      loserConversions: draftsToConversionRows(loserConversions),
      winnerName: winner.name,
      loserName: loser.name,
    });
  }, [winner, loser, winnerConversions, loserConversions]);

  useEffect(() => {
    if (step !== "confirm" || !winner || !loser || conversionsLoading) return;
    if (factorMode === "manual") return;
    if (factorCandidates.length === 0) {
      setFactorMode("manual");
      setSelectedFactorId(null);
      return;
    }
    if (
      selectedFactorId &&
      factorCandidates.some((c) => c.id === selectedFactorId)
    ) {
      return;
    }
    if (unitResolution?.kind === "same") {
      const same = factorCandidates.find((c) => c.id === "same");
      setSelectedFactorId(same?.id ?? factorCandidates[0]!.id);
      return;
    }
    if (unitResolution?.kind === "auto") {
      const match = factorCandidates.find(
        (c) => Math.abs(c.factor - unitResolution.factor) < 1e-6,
      );
      setSelectedFactorId(match?.id ?? factorCandidates[0]!.id);
      return;
    }
    setSelectedFactorId(factorCandidates[0]!.id);
  }, [
    step,
    winner,
    loser,
    conversionsLoading,
    factorCandidates,
    factorMode,
    selectedFactorId,
    unitResolution,
  ]);

  const manualFactor = useMemo(() => {
    const a = parseFloat(manualLoserQty.replace(/\s/g, "").replace(",", "."));
    const b = parseFloat(manualWinnerQty.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      return null;
    }
    return b / a;
  }, [manualLoserQty, manualWinnerQty]);

  const selectedCandidate = useMemo(
    () => factorCandidates.find((c) => c.id === selectedFactorId) ?? null,
    [factorCandidates, selectedFactorId],
  );

  const effectiveFactor = useMemo(() => {
    if (factorMode === "manual") return manualFactor;
    if (selectedCandidate) return selectedCandidate.factor;
    if (!unitResolution) return null;
    if (unitResolution.kind === "same") return 1;
    if (unitResolution.kind === "auto") return unitResolution.factor;
    return manualFactor;
  }, [factorMode, selectedCandidate, unitResolution, manualFactor]);

  const stockPreview = useMemo(() => {
    if (!winner || !loser || effectiveFactor == null) return null;
    const loserAdj = convertLoserQuantityToWinner(
      Number(loser.current_quantity),
      effectiveFactor,
    );
    if (loserAdj == null) return null;
    const total = Number(winner.current_quantity) + loserAdj;
    return { loserAdj, total };
  }, [winner, loser, effectiveFactor]);

  const needsManualUnit = factorMode === "manual";

  const canConfirm =
    !!winner &&
    !!loser &&
    !conversionsLoading &&
    effectiveFactor != null &&
    effectiveFactor > 0 &&
    (!needsManualUnit || manualFactor != null);

  const reset = () => {
    setSearch("");
    setPartnerId(null);
    setPartner(null);
    setCandidates([]);
    setSurvivorIsSource(false);
    setStep("pick");
    setMerging(false);
    setWinnerConversions([]);
    setLoserConversions([]);
    setConversionsLoading(false);
    setManualLoserQty("1");
    setManualWinnerQty("1");
    setSelectedFactorId(null);
    setFactorMode("candidate");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!winner || !loser || effectiveFactor == null) return;
    setMerging(true);
    const mergedConversions = buildMergedUnitConversionsForMerge({
      winnerHub: winner.unit,
      winnerConversions: draftsToConversionRows(winnerConversions),
      loserHub: loser.unit,
      loserConversions: draftsToConversionRows(loserConversions),
      loserToWinnerFactor: effectiveFactor,
    });
    const result = await mergeCompanyProducts(companyId, winner.id, loser.id, {
      loserToWinnerFactor: effectiveFactor,
      mergedUnitConversions: mergedConversionsToJson(mergedConversions),
    });
    setMerging(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Produtos unificados. «${loser.name}» passou a ser reconhecido como «${winner.name}».`,
      {
        description:
          "O histórico do produto registra a unificação — você pode desfazê-la na aba Resumo ou Histórico.",
      },
    );
    onMerged(result.winnerId);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Unificar produtos</DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? "Escolha o outro cadastro que é o mesmo item — inclusive um que já unificou outros produtos."
              : "Revise o resultado: estoque, histórico de movimentações e vínculos vão para o produto que permanece."}
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
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      {hasMergedCatalogItems(p) ? (
                        <span className="block text-[0.65rem] text-muted-foreground">
                          Já unificou {mergedCatalogNameCount(p)}{" "}
                          {mergedCatalogNameCount(p) === 1 ? "item" : "itens"}
                        </span>
                      ) : null}
                    </span>
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
              lockReason={
                survivorLock.locked ? survivorLock.reason : undefined
              }
            />
            <ProductMergeCard
              product={loser}
              formatCurrency={formatCurrency}
              variant="removed"
            />
            {survivorLock.locked ? (
              <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-950 dark:text-amber-100">
                Não é possível trocar quem permanece: {winner.name} já tem
                itens unificados. O novo cadastro é absorvido para não perder
                a referência.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setSurvivorIsSource((v) => !v);
                  setManualLoserQty("1");
                  setManualWinnerQty("1");
                  setSelectedFactorId(null);
                  setFactorMode("candidate");
                }}
              >
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Trocar qual produto permanece
              </Button>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Scale className="h-4 w-4 text-muted-foreground" />
                Conversões de cada item
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Veja as regras de cada cadastro, inclua uma nova se faltar, e
                escolha qual proporção usar na unificação.
              </p>
              {conversionsLoading ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando conversões…
                </p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <MergeProductConversionsEditor
                      companyId={companyId}
                      productId={winner.id}
                      productName={winner.name}
                      stockUnitCode={winner.unit}
                      value={winnerConversions}
                      onChange={setWinnerConversions}
                    />
                  </div>
                  <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
                    <MergeProductConversionsEditor
                      companyId={companyId}
                      productId={loser.id}
                      productName={loser.name}
                      stockUnitCode={loser.unit}
                      value={loserConversions}
                      onChange={setLoserConversions}
                    />
                  </div>
                </div>
              )}

              {!conversionsLoading ? (
                <div className="mt-4 space-y-3">
                  <MergeFactorChoiceList
                    candidates={factorCandidates}
                    selectedId={selectedFactorId}
                    onSelect={(id) => {
                      setFactorMode("candidate");
                      setSelectedFactorId(id);
                    }}
                    manualSelected={factorMode === "manual"}
                    onSelectManual={() => setFactorMode("manual")}
                  />
                  {factorMode === "manual" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="merge-manual-loser" className="text-xs">
                          Quantidade ({loser.unit})
                        </Label>
                        <Input
                          id="merge-manual-loser"
                          className="w-24"
                          inputMode="decimal"
                          value={manualLoserQty}
                          onChange={(e) => setManualLoserQty(e.target.value)}
                        />
                      </div>
                      <span className="pb-2 text-sm text-muted-foreground">
                        {unitLabel(loser.unit)} =
                      </span>
                      <div className="space-y-1">
                        <Label htmlFor="merge-manual-winner" className="text-xs">
                          Quantidade ({winner.unit})
                        </Label>
                        <Input
                          id="merge-manual-winner"
                          className="w-24"
                          inputMode="decimal"
                          value={manualWinnerQty}
                          onChange={(e) => setManualWinnerQty(e.target.value)}
                        />
                      </div>
                      <span className="pb-2 text-sm text-muted-foreground">
                        {unitLabel(winner.unit)}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {stockPreview && effectiveFactor != null ? (
                <p className="mt-3 rounded-lg border border-border/80 bg-background px-3 py-2 text-xs text-muted-foreground">
                  Estoque após unificação:{" "}
                  <span className="font-medium text-foreground">
                    {Number(winner.current_quantity).toLocaleString("pt-BR")}{" "}
                    {winner.unit}
                  </span>
                  {" + "}
                  <span className="font-medium text-foreground">
                    {Number(loser.current_quantity).toLocaleString("pt-BR")}{" "}
                    {loser.unit}
                  </span>
                  {" → "}
                  <span className="font-medium text-foreground">
                    {stockPreview.loserAdj.toLocaleString("pt-BR", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {winner.unit}
                  </span>
                  {" = "}
                  <span className="font-semibold text-foreground">
                    {stockPreview.total.toLocaleString("pt-BR", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {winner.unit}
                  </span>
                </p>
              ) : null}
            </div>

            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Soma as quantidades em estoque (com conversão se necessário)</li>
              <li>
                Corrige vínculo e histórico de movimentações dos dois cadastros
              </li>
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
              disabled={merging || !canConfirm}
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

import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { InventoryCountPackCalculator } from "@/components/estoque/InventoryCountPackCalculator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTheme } from "@/contexts/ThemeContext";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { formatPackCountQty } from "@/lib/inventoryCount/packCountCalculator";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  Check,
  ClipboardList,
  Loader2,
  Menu,
  ScanBarcode,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen justify-center overflow-y-auto bg-background p-4 py-10">
      <Link
        to="/"
        className="absolute left-4 top-4 z-20 flex items-center transition-opacity hover:opacity-90 sm:left-6 sm:top-6"
        aria-label="Faro — início"
      >
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt=""
          width={140}
          height={40}
          className="h-8 w-auto max-w-[min(140px,50vw)] object-contain object-left sm:h-12"
          decoding="async"
        />
      </Link>
      <div
        className="pointer-events-none fixed inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md pt-10">{children}</div>
    </div>
  );
}

type AllowedUnit = {
  code: string;
  hint?: string | null;
  qty_in_hub?: number | null;
};

type ProductLine = {
  id: string;
  line_id: string;
  name: string;
  sku: string | null;
  unit: string;
  barcode?: string | null;
  counted_qty?: number | null;
  counted_unit_code?: string | null;
  allowed_units?: AllowedUnit[];
  recount_required?: boolean;
  sort_order?: number;
  listing_id?: string | null;
  listing_name?: string | null;
  group_id?: string | null;
  group_name?: string | null;
};

type CountPoint = {
  listing_id: string | null;
  listing_name: string;
  group_id: string | null;
  group_name: string;
  total: number;
  counted: number;
};

type LoadJson = {
  ok: boolean;
  error?: string;
  status?: string;
  company_name?: string;
  group_name?: string;
  listing_name?: string;
  assigned_to_name?: string;
  products?: ProductLine[];
  points?: CountPoint[];
};

function publicCountErrorMessage(code: string | undefined): string {
  if (code === "closed" || code === "already_submitted") {
    return "Esta contagem já foi enviada ou o link expirou.";
  }
  if (code === "listing_required") {
    return "Esta contagem precisa de uma listagem. Peça um link gerado em Contagem.";
  }
  if (code === "group_required") {
    return "Esta contagem precisa de um grupo. Peça um link gerado em Contagem.";
  }
  if (code === "incomplete") {
    return "Ainda há itens sem quantidade.";
  }
  return "Link inválido ou expirado.";
}

function unitsForProduct(p: ProductLine): AllowedUnit[] {
  if (p.allowed_units && p.allowed_units.length > 0) return p.allowed_units;
  return [{ code: p.unit, hint: null }];
}

function lineKey(p: ProductLine): string {
  return p.line_id || p.id;
}

function lineIsPending(p: ProductLine, sessionStatus: string): boolean {
  if (sessionStatus === "returned") {
    return Boolean(p.recount_required) && p.counted_qty == null;
  }
  return p.counted_qty == null;
}

function pointsFromProducts(
  products: ProductLine[],
  sessionStatus: string,
): CountPoint[] {
  const map = new Map<string, CountPoint>();
  for (const p of products) {
    const listingId = p.listing_id ?? "";
    const key = listingId || "_none";
    const row = map.get(key) ?? {
      listing_id: p.listing_id ?? null,
      listing_name: (p.listing_name ?? "").trim() || "Listagem",
      group_id: p.group_id ?? null,
      group_name: (p.group_name ?? "").trim(),
      total: 0,
      counted: 0,
    };
    row.total += 1;
    if (!lineIsPending(p, sessionStatus)) row.counted += 1;
    map.set(key, row);
  }
  return [...map.values()];
}

export function ContagemEstoquePublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [listingName, setListingName] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [sessionStatus, setSessionStatus] = useState("open");
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [qtyDraft, setQtyDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [packCalcOpen, setPackCalcOpen] = useState(false);
  const [recountIntroOpen, setRecountIntroOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const points = useMemo(
    () => pointsFromProducts(products, sessionStatus),
    [products, sessionStatus],
  );

  const queueAll = useMemo(() => {
    if (sessionStatus === "returned") {
      return products.filter((p) => p.recount_required);
    }
    return products;
  }, [products, sessionStatus]);

  const listingIds = useMemo(() => {
    const ids: string[] = [];
    for (const p of queueAll) {
      const id = p.listing_id ?? "";
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [queueAll]);

  const queue = useMemo(() => {
    if (listingIds.length <= 1) return queueAll;
    const wanted = activeListingId ?? listingIds[0] ?? "";
    return queueAll.filter((p) => (p.listing_id ?? "") === wanted);
  }, [queueAll, listingIds, activeListingId]);

  const current = queue[index] ?? null;
  const currentUnits = current ? unitsForProduct(current) : [];
  const currentHint =
    currentUnits.find((u) => u.code === unitDraft)?.hint ?? null;

  const pendingAll = useMemo(
    () => queueAll.filter((p) => lineIsPending(p, sessionStatus)),
    [queueAll, sessionStatus],
  );
  const roundComplete = pendingAll.length === 0 && queueAll.length > 0;

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_inventory_count_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar a contagem.");
      return;
    }
    const row = res as LoadJson;
    if (!row?.ok) {
      setError(publicCountErrorMessage(row?.error));
      return;
    }
    const list = (row.products ?? []).map((p) => ({
      ...p,
      line_id: p.line_id || p.id,
    }));
    const status = row.status ?? "open";
    setCompanyName(row.company_name ?? "");
    setGroupName((row.group_name ?? "").trim());
    setListingName((row.listing_name ?? "").trim());
    setAssignedToName((row.assigned_to_name ?? "").trim());
    setSessionStatus(status);
    const normalized =
      status === "returned"
        ? list.map((p) =>
            p.recount_required ? { ...p, counted_qty: null } : p,
          )
        : list;
    setProducts(normalized);
    const firstPending = normalized.find((p) => lineIsPending(p, status));
    setActiveListingId(firstPending?.listing_id ?? normalized[0]?.listing_id ?? null);
    setQtyDraft("");
    setIndex(0);
    setRecountIntroOpen(
      status === "returned" && list.some((p) => p.recount_required),
    );
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!current) return;
    setQtyDraft(
      current.counted_qty != null && current.counted_qty !== undefined
        ? String(current.counted_qty)
        : "",
    );
    const units = unitsForProduct(current);
    const saved = (current.counted_unit_code ?? "").trim().toLowerCase();
    const fallback = current.unit;
    setUnitDraft(units.some((u) => u.code === saved) ? saved : fallback);
    setPackCalcOpen(false);
  }, [current?.line_id, current?.id]);

  const confirmCurrent = async (): Promise<boolean> => {
    if (!token || !current) return false;
    const n = parseFloat(qtyDraft.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Informe uma quantidade válida.");
      return false;
    }
    setSaving(true);
    setError(null);
    setSavedNote(null);
    const baseArgs = {
      p_token: token,
      p_product_id: current.id,
      p_counted_qty: n,
      p_counted_unit_code: unitDraft || current.unit,
    };
    let { data: res, error: err } = await supabase.rpc(
      "set_inventory_count_line_public",
      {
        ...baseArgs,
        p_line_id: current.line_id || current.id,
      },
    );
    if (err) {
      const retry = await supabase.rpc("set_inventory_count_line_public", baseArgs);
      res = retry.data;
      err = retry.error;
    }
    setSaving(false);
    if (err) {
      setError("Não foi possível salvar este item.");
      return false;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      setError(
        row?.error === "not_returned_item"
          ? "Este item não precisa de recontagem."
          : row?.error === "invalid_unit"
            ? "Esta unidade não vale para o produto. Escolha outra."
            : "Não foi possível salvar este item.",
      );
      return false;
    }

    setProducts((prev) =>
      prev.map((p) =>
        lineKey(p) === lineKey(current)
          ? {
              ...p,
              counted_qty: n,
              counted_unit_code: unitDraft || current.unit,
              recount_required: false,
            }
          : p,
      ),
    );
    return true;
  };

  const goToLine = (line: ProductLine) => {
    setActiveListingId(line.listing_id ?? null);
    const listingQueue =
      sessionStatus === "returned"
        ? products.filter(
            (p) =>
              p.recount_required &&
              (p.listing_id ?? "") === (line.listing_id ?? ""),
          )
        : products.filter((p) => (p.listing_id ?? "") === (line.listing_id ?? ""));
    const idx = listingQueue.findIndex((p) => lineKey(p) === lineKey(line));
    setIndex(idx >= 0 ? idx : 0);
    setError(null);
    setNavOpen(false);
  };

  const goNext = async () => {
    const ok = await confirmCurrent();
    if (!ok) return;
    if (index < queue.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    const nextPending = pendingAll.find(
      (p) => lineKey(p) !== (current ? lineKey(current) : ""),
    );
    if (nextPending) {
      goToLine(nextPending);
    }
  };

  const savePause = async () => {
    const ok = await confirmCurrent();
    if (!ok) return;
    setSavedNote("Salvo. Pode fechar e voltar pelo mesmo link.");
  };

  const submit = async () => {
    if (!token) return;
    if (!roundComplete) {
      setNavOpen(true);
      setError("Ainda há pontos sem quantidade.");
      return;
    }
    if (current) {
      const ok = await confirmCurrent();
      if (!ok) return;
    }

    setSubmitting(true);
    const { data: res, error: err } = await supabase.rpc(
      "submit_inventory_count_for_approval",
      {
        p_token: token,
        p_inventory_count_group_id: null,
      },
    );
    setSubmitting(false);
    if (err) {
      setError("Não foi possível enviar. Tente novamente.");
      return;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      if (row?.error === "incomplete") {
        setError("Ainda há itens sem quantidade.");
        setNavOpen(true);
        return;
      }
      if (row?.error === "group_required" || row?.error === "listing_required") {
        setError(publicCountErrorMessage(row.error));
        return;
      }
      setError(
        row?.error === "already_submitted"
          ? "Esta contagem já foi enviada."
          : "Não foi possível salvar.",
      );
      return;
    }
    setDone(true);
  };

  const jumpBarcode = () => {
    const q = barcodeQuery.trim();
    if (!q) return;
    const found = queueAll.find(
      (p) =>
        (p.barcode && p.barcode === q) ||
        (p.sku && p.sku.toLowerCase() === q.toLowerCase()) ||
        p.name.toLowerCase().includes(q.toLowerCase()),
    );
    if (!found) {
      setError("Item não encontrado nesta contagem.");
      return;
    }
    setError(null);
    setBarcodeQuery("");
    goToLine(found);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando…
        </div>
      </PublicPageShell>
    );
  }

  if (error && !current && !done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Contagem de estoque</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Contagem enviada
            </CardTitle>
            <CardDescription>
              Enviada para aprovação do responsável. O estoque só muda depois da
              conferência. Obrigado!
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (!current) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Contagem de estoque</CardTitle>
            <CardDescription>
              {sessionStatus === "returned"
                ? "Nada pendente nesta recontagem. Pode fechar esta tela."
                : "Nenhum produto para contar."}
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  const progressLabel = `${index + 1} de ${queue.length}`;
  const currentGroupName = (current.group_name ?? "").trim() || groupName;
  const currentListingName = (current.listing_name ?? "").trim() || listingName;
  const groupedPoints = new Map<string, CountPoint[]>();
  for (const point of points) {
    const key = point.group_name || "Pontos";
    const list = groupedPoints.get(key) ?? [];
    list.push(point);
    groupedPoints.set(key, list);
  }

  return (
    <PublicPageShell>
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ClipboardList className="h-5 w-5" />
            <span className="flex-1">Contagem</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Pontos da contagem"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
          </CardTitle>
          <CardDescription className="space-y-1">
            {companyName ? (
              <p className="font-medium text-foreground">{companyName}</p>
            ) : null}
            {currentGroupName ? <p>Setor: {currentGroupName}</p> : null}
            {currentListingName ? <p>Ponto: {currentListingName}</p> : null}
            {assignedToName ? <p>Operador: {assignedToName}</p> : null}
            {sessionStatus === "returned" ? (
              <p className="text-amber-700 dark:text-amber-400">
                Conte de novo e, no último item, envie.
              </p>
            ) : (
              <p>
                {pendingAll.length === 0
                  ? "Todos os pontos desta rodada foram contados."
                  : `${pendingAll.length} item(ns) pendente(s) na rodada.`}
              </p>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Código de barras, SKU ou nome…"
              value={barcodeQuery}
              onChange={(e) => setBarcodeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpBarcode();
                }
              }}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={jumpBarcode}>
              Ir
            </Button>
          </div>

          <div className="rounded-2xl border bg-muted/30 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {progressLabel}
            </p>
            <h2 className="mt-2 text-2xl font-bold leading-tight">
              {current.name}
            </h2>

            <label className="mt-6 block text-left text-xs font-semibold uppercase text-muted-foreground">
              Quantidade contada
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                aria-label="Quantidade contada"
                className="h-16 min-w-[6.5rem] flex-1 text-center text-3xl font-bold tabular-nums"
                value={qtyDraft}
                onChange={(e) => setQtyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void goNext();
                  }
                }}
              />
              <SearchSelect
                value={unitDraft || current.unit}
                onValueChange={setUnitDraft}
                disabled={packCalcOpen}
                searchPlaceholder="Buscar unidade…"
                className="w-[7.5rem] shrink-0"
                triggerClassName="h-16 text-base"
                options={currentUnits.map((u) => ({
                  value: u.code,
                  label: `${systemUnitLabel(u.code)} (${u.code})`,
                }))}
              />
            </div>
            {currentHint ? (
              <p className="mt-2 text-xs text-muted-foreground">{currentHint}</p>
            ) : null}
            <InventoryCountPackCalculator
              key={lineKey(current)}
              hubUnit={current.unit}
              allowedUnits={currentUnits}
              onOpenChange={(open) => {
                setPackCalcOpen(open);
                if (open) {
                  setUnitDraft(current.unit);
                  if (qtyDraft.trim() === "") setQtyDraft("0");
                }
              }}
              onApply={(qty, unit) => {
                setQtyDraft(formatPackCountQty(qty));
                setUnitDraft(unit);
              }}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          {savedNote ? (
            <p className="text-sm text-muted-foreground">{savedNote}</p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={index === 0 || saving || submitting}
              onClick={() => {
                setIndex((i) => Math.max(0, i - 1));
                setError(null);
                setSavedNote(null);
              }}
            >
              Anterior
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={saving || submitting}
              onClick={() => void goNext()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Próximo"}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={saving || submitting}
            onClick={() => void savePause()}
          >
            Salvar
          </Button>
          <Button
            type="button"
            className="w-full"
            disabled={saving || submitting}
            onClick={() => void submit()}
          >
            {submitting || saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : sessionStatus === "returned" ? (
              "Enviar de novo"
            ) : (
              "Enviar p/ aprovação"
            )}
          </Button>
        </CardContent>
      </Card>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0">
          <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 pb-4 pt-6 pr-14 text-left">
            <SheetTitle>Pontos da rodada</SheetTitle>
            <p className="text-sm text-muted-foreground">
              {pendingAll.length === 0
                ? "Nada pendente. Pode enviar."
                : `${pendingAll.length} item(ns) ainda sem quantidade.`}
            </p>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {[...groupedPoints.entries()].map(([gName, gPoints]) => (
              <div key={gName} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {gName}
                </p>
                {gPoints.map((point) => {
                  const listingProducts = queueAll.filter(
                    (p) => (p.listing_id ?? "") === (point.listing_id ?? ""),
                  );
                  const pending = listingProducts.filter((p) =>
                    lineIsPending(p, sessionStatus),
                  );
                  const active =
                    (activeListingId ?? "") === (point.listing_id ?? "");
                  return (
                    <div key={point.listing_id ?? gName} className="space-y-1">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                          active
                            ? "border-foreground/20 bg-muted"
                            : "border-border bg-card",
                          pending.length > 0 && "border-amber-500/40",
                        )}
                        onClick={() => {
                          const target =
                            pending[0] ?? listingProducts[0] ?? null;
                          if (target) goToLine(target);
                          else {
                            setActiveListingId(point.listing_id);
                            setIndex(0);
                            setNavOpen(false);
                          }
                        }}
                      >
                        <span className="font-medium">{point.listing_name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {point.counted}/{point.total}
                        </span>
                      </button>
                      {listingProducts.length > 0 ? (
                        <ul className="space-y-1 pl-2">
                          {listingProducts.map((p) => {
                            const pendingItem = lineIsPending(p, sessionStatus);
                            return (
                              <li key={lineKey(p)}>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted/60"
                                  onClick={() => goToLine(p)}
                                >
                                  {pendingItem ? (
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                  ) : (
                                    <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">
                                    {p.name}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={recountIntroOpen} onOpenChange={setRecountIntroOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conte estes itens de novo</AlertDialogTitle>
            <AlertDialogDescription>
              {queueAll.length === 1
                ? "O responsável pediu para conferir 1 item outra vez."
                : `O responsável pediu para conferir ${queueAll.length} itens outra vez.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            <li>Conte a quantidade de cada um.</li>
            <li>Pode salvar para pausar e voltar pelo mesmo link.</li>
            <li>Quando todos os pontos estiverem prontos, envie de novo.</li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogAction className="w-full">Começar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PublicPageShell>
  );
}

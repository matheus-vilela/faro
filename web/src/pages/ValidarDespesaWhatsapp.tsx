import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExpenseImportAttentionPanel } from "@/components/expenses/ExpenseImportAttentionPanel";
import { ProductSelectPopover } from "@/components/whatsapp/ProductSelectPopover";
import { useTheme } from "@/contexts/ThemeContext";
import {
  countLinesNeedingProductReview,
  divergenceReasonLabel,
  itemLineNeedsProductReview,
} from "@/lib/expenseDivergenceUi";
import { refreshWhatsappDraftProductMatches } from "@/lib/refreshWhatsappDraftMatches";
import { supabasePublic } from "@/lib/supabasePublic";
import { cn } from "@/lib/utils";
import { pickInvoiceUnitRaw } from "@/lib/productImport/consolidateItems";
import { canonicalProductName } from "@/lib/productImport/canonicalName";
import {
  formatDecimalPtBrInput,
  parseDecimalPtBrInput,
  recalcLineTotal,
  sanitizeDecimalPtBrTyping,
  sumItems,
  type ExtractedDocumentResult,
  type ExtractedExpenseItem,
  type ExtractedExpenseItemWithMatch,
} from "@/lib/whatsappExtractedExpense";
import {
  Building2,
  FileText,
  Package,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

function DraftPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
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
        className="pointer-events-none absolute inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_75%)]"
        aria-hidden
      />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}

function coerceExtracted(raw: unknown): ExtractedDocumentResult {
  const o = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  return {
    validDocument: true,
    _requiresProductConfirmation:
      typeof o._requiresProductConfirmation === "boolean"
        ? o._requiresProductConfirmation
        : undefined,
    documentKind:
      (o.documentKind as ExtractedDocumentResult["documentKind"]) ?? null,
    supplierName: (o.supplierName as string) ?? null,
    supplierDocument: (o.supplierDocument as string) ?? null,
    invoiceNumber: (o.invoiceNumber as string) ?? null,
    invoiceSeries: (o.invoiceSeries as string) ?? null,
    totalAmount:
      typeof o.totalAmount === "number"
        ? o.totalAmount
        : Number(o.totalAmount ?? 0),
    notes: (o.notes as string) ?? null,
    items: itemsRaw.map((row) => {
      const r = row as Record<string, unknown>;
      const it: ExtractedExpenseItemWithMatch = {
        productName: String(r.productName ?? ""),
        quantity: Number(r.quantity ?? 0),
        unitValue: Number(r.unitValue ?? 0),
        lineTotal: Number(r.lineTotal ?? 0),
        unitCommercial: (r.unitCommercial as string | null | undefined) ?? null,
        unitTax: (r.unitTax as string | null | undefined) ?? null,
        ncm: (r.ncm as string | null | undefined) ?? null,
        ean: (r.ean as string | null | undefined) ?? null,
        productId:
          (r.productId as string | undefined) ??
          (r.product_id as string | undefined) ??
          null,
        productMatch:
          r.productMatch as ExtractedExpenseItemWithMatch["productMatch"],
      };
      return recalcLineTotal(it) as ExtractedExpenseItemWithMatch;
    }),
  };
}

type LineBinding = {
  productId: string | null;
  createNew: boolean;
  newName: string;
  /** Nome no catálogo quando há produto vinculado (exibição no seletor). */
  catalogProductName: string | null;
};

/** Sem vínculo automático: abre cadastro rápido com o nome da nota (usuário pode trocar para um produto da lista). */
function initLineBindings(ex: ExtractedDocumentResult): LineBinding[] {
  return ex.items.map((it) => {
    const m = it.productMatch;
    const pid = it.productId ?? m?.resolvedProductId ?? null;
    let catalogProductName: string | null = null;
    if (pid && m?.suggestedProductName) {
      if (pid === m.resolvedProductId || pid === m.suggestedProductId) {
        catalogProductName = m.suggestedProductName;
      }
    }
    return {
      productId: pid,
      createNew: !pid,
      newName: it.productName ?? "",
      catalogProductName,
    };
  });
}

function lineItemInputStringsFromItems(items: ExtractedExpenseItem[]): {
  qty: string[];
  unit: string[];
} {
  return {
    qty: items.map((it) => formatDecimalPtBrInput(it.quantity, 4)),
    unit: items.map((it) => formatDecimalPtBrInput(it.unitValue, 4)),
  };
}

function buildPayloadForFinalize(
  extracted: ExtractedDocumentResult,
  bindings: LineBinding[],
  divergenceReasonValue: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    validDocument: extracted.validDocument,
    documentKind: extracted.documentKind,
    supplierName: extracted.supplierName,
    supplierDocument: extracted.supplierDocument,
    invoiceNumber: extracted.invoiceNumber,
    invoiceSeries: extracted.invoiceSeries,
    totalAmount: extracted.totalAmount,
    notes: extracted.notes,
    items: extracted.items.map((it, i) => {
      const b = bindings[i];
      const m = it.productMatch;
      const invoiceUnit = pickInvoiceUnitRaw(it) ?? "";
      const row: Record<string, unknown> = {
        productName: it.productName,
        quantity: it.quantity,
        unitValue: it.unitValue,
        lineTotal: it.lineTotal,
        unitCommercial: it.unitCommercial ?? null,
        unitTax: it.unitTax ?? null,
        ncm: it.ncm ?? null,
        ean: it.ean ?? null,
        invoiceUnit: invoiceUnit || null,
        matchScore: m?.suggestedScore ?? null,
        matchDecisionReason: m?.matchReason ?? null,
        stockQuantity: m?.stockQuantity ?? null,
        conversionFactorApplied: m?.conversionFactorApplied ?? null,
        resolutionSource: m?.resolutionSource ?? null,
        normalizedInvoiceUnit: m?.invoiceUnitNormalized ?? null,
        catalogUnitNormalized: m?.catalogUnitNormalized ?? null,
      };
      if (b?.createNew) {
        row.createProduct = true;
        row.newProductName = (b.newName || it.productName).trim() || "Produto";
        row.productUnit = invoiceUnit.trim() || null;
        row.canonicalName = canonicalProductName(
          (b.newName || it.productName).trim() || "",
        );
        row.importResolutionStatus = "NEW_PRODUCT_CREATED";
      } else if (b?.productId) {
        row.productId = b.productId;
        const keptAuto =
          m?.resolutionStatus === "AUTO_MATCH" &&
          b.productId === (it.productId ?? m?.resolvedProductId ?? null);
        row.importResolutionStatus = keptAuto
          ? "AUTO_MATCH"
          : "USER_CONFIRMED_MATCH";
      }
      return row;
    }),
  };
  if (divergenceReasonValue.trim()) {
    payload.divergenceReason = divergenceReasonLabel(divergenceReasonValue);
  }
  return payload;
}

export function ValidarDespesaWhatsapp() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedDocumentResult | null>(
    null,
  );
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lineBindings, setLineBindings] = useState<LineBinding[]>([]);
  /** Texto livre nos inputs de qtd/valor (permite apagar antes de digitar de novo). */
  const [qtyInputs, setQtyInputs] = useState<string[]>([]);
  const [unitInputs, setUnitInputs] = useState<string[]>([]);
  /** IDs estáveis por linha (React key + scroll/destaque). */
  const [itemRowIds, setItemRowIds] = useState<string[]>([]);
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  /** Alinhado após cada load; transição true→false dispara toast (usuário corrigiu divergência). */
  const prevDivergeRef = useRef(false);
  const [divergenceReasonValue, setDivergenceReasonValue] = useState("");

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabasePublic.rpc(
      "get_whatsapp_expense_draft_by_token",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar");
      return;
    }
    const obj = res as {
      error?: string;
      extracted_json?: unknown;
      expires_at?: string;
    };
    if (obj?.error) {
      setError(obj.error);
      setExtracted(null);
      return;
    }
    if (!obj.extracted_json) {
      setError("Dados inválidos");
      return;
    }
    const refreshed = await refreshWhatsappDraftProductMatches(token);
    const rawExtracted = refreshed ?? obj.extracted_json;
    const coerced = coerceExtracted(rawExtracted);
    const tn0 = coerced.totalAmount ?? 0;
    const sm0 = sumItems(coerced.items);
    prevDivergeRef.current =
      Math.abs(Math.round(tn0 * 100) - Math.round(sm0 * 100)) > 2;
    setExtracted(coerced);
    const baseBindings = initLineBindings(coerced);
    const idsMissingLabel = [
      ...new Set(
        baseBindings
          .filter((b) => b.productId && !b.catalogProductName)
          .map((b) => b.productId as string),
      ),
    ];
    if (idsMissingLabel.length > 0) {
      const { data: labelRows } = await supabasePublic.rpc(
        "resolve_whatsapp_draft_product_labels",
        { p_token: token, p_ids: idsMissingLabel },
      );
      const rows = Array.isArray(labelRows) ? labelRows : [];
      const map = new Map(
        rows.map((r: { id: string; name: string }) => [r.id, r.name]),
      );
      setLineBindings(
        baseBindings.map((b) =>
          b.productId && !b.catalogProductName && map.has(b.productId)
            ? { ...b, catalogProductName: map.get(b.productId)! }
            : b,
        ),
      );
    } else {
      setLineBindings(baseBindings);
    }
    const str = lineItemInputStringsFromItems(coerced.items);
    setQtyInputs(str.qty);
    setUnitInputs(str.unit);
    setItemRowIds(coerced.items.map(() => crypto.randomUUID()));
    setExpiresAt(obj.expires_at ?? null);
    setError(null);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => load());
  }, [load]);

  useEffect(() => {
    if (!extracted) return;
    setItemRowIds((prev) => {
      const n = extracted.items.length;
      if (prev.length === n) return prev;
      if (prev.length > n) return prev.slice(0, n);
      const next = [...prev];
      while (next.length < n) next.push(crypto.randomUUID());
      return next;
    });
  }, [extracted?.items.length]);

  useLayoutEffect(() => {
    if (!flashRowId) return;
    const el = document.getElementById(`draft-line-${flashRowId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusT = window.setTimeout(() => {
      const focusable = el?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), [role="combobox"]',
      );
      focusable?.focus({ preventScroll: true });
    }, 450);
    const clearFlash = window.setTimeout(() => setFlashRowId(null), 5000);
    return () => {
      window.clearTimeout(focusT);
      window.clearTimeout(clearFlash);
    };
  }, [flashRowId]);

  const updateItem = (i: number, patch: Partial<ExtractedExpenseItem>) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      const next = { ...items[i], ...patch };
      items[i] = recalcLineTotal(next as ExtractedExpenseItem);
      return { ...prev, items };
    });
    if (patch.productName !== undefined) {
      setLineBindings((prev) => {
        const next = [...prev];
        if (next[i]) {
          next[i] = { ...next[i], newName: String(patch.productName ?? "") };
        }
        return next;
      });
    }
  };

  const totalNota = extracted?.totalAmount ?? 0;
  const soma = extracted ? sumItems(extracted.items) : 0;
  const diverge =
    Math.abs(Math.round(totalNota * 100) - Math.round(soma * 100)) > 2;

  useEffect(() => {
    if (!extracted) return;
    if (prevDivergeRef.current && !diverge) {
      toast.success("Diferença corrigida", {
        description:
          "O total da nota e a soma dos itens agora conferem. Revise e finalize quando estiver pronto.",
      });
    }
    prevDivergeRef.current = diverge;
  }, [diverge, extracted]);

  const insertItemAt = useCallback((atIndex: number | "append") => {
    const newId = crypto.randomUUID();
    setFlashRowId(newId);

    const blank: ExtractedExpenseItemWithMatch = {
      productName: "",
      quantity: 1,
      unitValue: 0,
      lineTotal: 0,
      productId: null,
      productMatch: undefined,
    };
    const line = recalcLineTotal(blank) as ExtractedExpenseItemWithMatch;
    const binding: LineBinding = {
      productId: null,
      createNew: true,
      newName: "",
      catalogProductName: null,
    };

    const resolveIdx = (len: number) =>
      atIndex === "append" ? len : Math.max(0, Math.min(atIndex, len));

    setExtracted((prev) => {
      if (!prev) return prev;
      const idx = resolveIdx(prev.items.length);
      const items = [...prev.items];
      items.splice(idx, 0, line);
      return { ...prev, items };
    });
    setLineBindings((prev) => {
      const idx = resolveIdx(prev.length);
      const next = [...prev];
      next.splice(idx, 0, binding);
      return next;
    });
    setQtyInputs((prev) => {
      const idx = resolveIdx(prev.length);
      const next = [...prev];
      next.splice(idx, 0, formatDecimalPtBrInput(1, 4));
      return next;
    });
    setUnitInputs((prev) => {
      const idx = resolveIdx(prev.length);
      const next = [...prev];
      next.splice(idx, 0, formatDecimalPtBrInput(0, 4));
      return next;
    });
    setItemRowIds((prev) => {
      const idx = resolveIdx(prev.length);
      const next = [...prev];
      next.splice(idx, 0, newId);
      return next;
    });
  }, []);

  // const addItemAtEnd = useCallback(() => {
  //   insertItemAt("append");
  // }, [insertItemAt]);

  const removeItem = (index: number) => {
    setExtracted((prev) => {
      if (!prev || prev.items.length <= 1) return prev;
      return { ...prev, items: prev.items.filter((_, j) => j !== index) };
    });
    setLineBindings((prev) => prev.filter((_, j) => j !== index));
    setQtyInputs((prev) => prev.filter((_, j) => j !== index));
    setUnitInputs((prev) => prev.filter((_, j) => j !== index));
    setItemRowIds((prev) => prev.filter((_, j) => j !== index));
  };

  const handleSave = async () => {
    if (!token || !extracted) return;
    if (extracted.items.length === 0) {
      setError("Inclua pelo menos um item.");
      return;
    }
    if (!extracted.totalAmount || extracted.totalAmount <= 0) {
      setError("Informe o total da nota.");
      return;
    }
    for (let i = 0; i < extracted.items.length; i++) {
      const b = lineBindings[i];
      const label = extracted.items[i]?.productName ?? `Item ${i + 1}`;
      if (!b) {
        setError(`Confirme o produto da linha: ${label}`);
        return;
      }
      if (!b.createNew && !b.productId) {
        setError(
          `Vincule "${label}" a um produto do cadastro ou crie um produto novo.`,
        );
        return;
      }
      if (b.createNew && !(b.newName || label).trim()) {
        setError(`Informe o nome do produto novo na linha: ${label}`);
        return;
      }
    }
    for (let i = 0; i < extracted.items.length; i++) {
      const it = extracted.items[i];
      const label = it.productName?.trim() || `Item ${i + 1}`;
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        setError(`Informe quantidade maior que zero em "${label}".`);
        return;
      }
      if (!Number.isFinite(it.unitValue) || it.unitValue <= 0) {
        setError(`Informe valor unitário maior que zero em "${label}".`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const payload = buildPayloadForFinalize(
      extracted,
      lineBindings,
      divergenceReasonValue,
    );
    const { data: res, error: err } = await supabasePublic.rpc(
      "finalize_whatsapp_expense_draft",
      {
        p_token: token,
        p_extracted_json: payload,
      },
    );
    setSaving(false);
    if (err) {
      setError("Não foi possível salvar. Tente novamente.");
      return;
    }
    const obj = res as { success?: boolean; error?: string };
    if (!obj?.success) {
      setError(obj?.error ?? "Não foi possível salvar.");
      return;
    }
    setSuccess(true);
  };

  if (loading) {
    return (
      <DraftPageShell>
        <div className="flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DraftPageShell>
    );
  }

  if (error && !extracted) {
    return (
      <DraftPageShell>
        <Card className="mx-auto max-w-md w-full">
          <CardHeader>
            <CardTitle>Link inválido, expirado ou já utilizado</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Cada link vale para uma única correção. Depois de salvar, o link
              deixa de funcionar. Se o prazo acabou ou você já registrou a
              despesa, peça um novo link no WhatsApp ou use *1*, *2* ou
              *cancelar* na conversa.
            </p>
          </CardContent>
        </Card>
      </DraftPageShell>
    );
  }

  if (success) {
    return (
      <DraftPageShell>
        <Card className="mx-auto max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <Receipt className="h-5 w-5" />
              Despesa registrada
            </CardTitle>
            <CardDescription>
              Os itens foram salvos. O <strong>proprietário</strong> da empresa
              precisa aprovar esta despesa no Faro antes dela valer para
              recebimento e alertas. Este link de correção foi invalidado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link to="/login">Entrar no Faro</Link>
            </Button>
          </CardContent>
        </Card>
      </DraftPageShell>
    );
  }

  if (!extracted) return null;

  return (
    <DraftPageShell>
      <Card className="mx-auto max-w-2xl w-full overflow-hidden border-border/80 shadow-md">
        <CardHeader className="space-y-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            <Wallet className="h-6 w-6 shrink-0 text-primary" />
            Conferir despesa (WhatsApp)
          </CardTitle>
          <CardDescription className="text-base">
            Ajuste os itens ou o total se o reconhecimento automático falhou.
            Depois salve para registrar a despesa.{" "}
            <span className="text-foreground font-medium">
              Não é necessário estar logado
            </span>{" "}
            nesta página — o próprio link autoriza esta correção.
          </CardDescription>
          {expiresAt && (
            <p className="text-xs text-muted-foreground">
              Link válido até{" "}
              {new Date(expiresAt).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            <div className="flex gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary"
                aria-hidden
              >
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="supplier">Fornecedor</Label>
                <Input
                  id="supplier"
                  value={extracted.supplierName ?? ""}
                  onChange={(e) =>
                    setExtracted({
                      ...extracted,
                      supplierName: e.target.value || null,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary"
                aria-hidden
              >
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="invoice">Nº documento (ex.: NFC-e)</Label>
                  <Input
                    id="invoice"
                    value={extracted.invoiceNumber ?? ""}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        invoiceNumber: e.target.value || null,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="serie">Série</Label>
                  <Input
                    id="serie"
                    value={extracted.invoiceSeries ?? ""}
                    onChange={(e) =>
                      setExtracted({
                        ...extracted,
                        invoiceSeries: e.target.value || null,
                      })
                    }
                    placeholder="Ex.: 1"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="total">Total da nota (R$)</Label>
              <Input
                id="total"
                type="text"
                inputMode="decimal"
                value={String(extracted.totalAmount ?? "")}
                onChange={(e) => {
                  const raw = e.target.value.replace(",", ".").trim();
                  const n = parseFloat(raw);
                  setExtracted({
                    ...extracted,
                    totalAmount: Number.isFinite(n) ? n : null,
                  });
                }}
              />
            </div>
          </div>

          <ExpenseImportAttentionPanel
            className="space-y-3"
            totalNota={totalNota}
            sumItens={soma}
            divergenceReasonValue={divergenceReasonValue}
            onDivergenceReasonChange={setDivergenceReasonValue}
            requiresProductConfirmation={!!extracted._requiresProductConfirmation}
            productReviewLineCount={countLinesNeedingProductReview(
              extracted.items,
            )}
          />

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold">Itens</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              O vínculo automático usa similaridade alta (limiar configurável),
              unidade compatível com o cadastro e, quando existirem, NCM/EAN. Se
              a unidade da nota divergir da cadastrada, não há conversão
              automática — confira e escolha vincular, criar novo ou ajustar.
              Use <strong>Inserir item aqui</strong> entre duas linhas para
              manter a ordem da nota.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 py-1">
                <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => insertItemAt(0)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Inserir no início
                </Button>
                <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
              </div>
              {extracted.items.map((it, i) => {
                const rowId = itemRowIds[i] ?? `fallback-${i}`;
                const binding = lineBindings[i] ?? {
                  productId: null,
                  createNew: false,
                  newName: it.productName ?? "",
                  catalogProductName: null,
                };
                const m = it.productMatch;
                const selectVal = binding.createNew
                  ? "__new__"
                  : binding.productId
                    ? binding.productId
                    : "__none__";
                return (
                  <Fragment key={rowId}>
                    <div
                      id={`draft-line-${rowId}`}
                      className={cn(
                        "rounded-lg border p-3 space-y-3 transition-shadow duration-500",
                        itemLineNeedsProductReview(it)
                          ? "border-amber-500/55 bg-amber-500/[0.06]"
                          : "border-border",
                        flashRowId === rowId &&
                          "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Item {i + 1}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeItem(i)}
                          disabled={extracted.items.length <= 1}
                          title={
                            extracted.items.length <= 1
                              ? "É necessário pelo menos um item"
                              : "Remover item"
                          }
                          aria-label="Remover item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Package
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Label className="text-xs">Descrição na nota</Label>
                          <Input
                            value={it.productName}
                            onChange={(e) =>
                              updateItem(i, { productName: e.target.value })
                            }
                          />
                          {(pickInvoiceUnitRaw(it) ||
                            it.unitCommercial ||
                            it.unitTax) && (
                            <p className="text-xs text-muted-foreground">
                              Unidade na nota:{" "}
                              <span className="font-medium text-foreground">
                                {pickInvoiceUnitRaw(it) ||
                                  it.unitCommercial ||
                                  it.unitTax}
                              </span>
                              {m?.catalogUnitNormalized != null &&
                                m.catalogUnitNormalized !== "" && (
                                  <>
                                    {" "}
                                    · cadastro sugerido:{" "}
                                    <span className="font-medium text-foreground">
                                      {String(m.catalogUnitNormalized)}
                                    </span>
                                  </>
                                )}
                            </p>
                          )}
                          {m?.needsConfirmation && (
                            <p className="text-xs text-amber-900 dark:text-amber-100 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5">
                              {m.resolutionStatus === "UNIT_CONFLICT_PENDING"
                                ? "Há produto semelhante, mas a unidade da nota difere da cadastrada — confirme o vínculo ou crie produto novo (sem conversão automática)."
                                : m.resolutionStatus === "PENDING_USER_CONFIRM"
                                  ? "Sugestão de produto no limiar intermediário — confirme o vínculo ou crie novo."
                                  : "Confirme o vínculo com um produto do cadastro ou use criar produto novo."}
                              {m.matchReason ? (
                                <span className="block mt-1 opacity-90">
                                  {m.matchReason}
                                </span>
                              ) : null}
                            </p>
                          )}
                          <div className="space-y-1">
                            <Label className="text-xs">Produto no Faro</Label>
                            {token ? (
                              <ProductSelectPopover
                                token={token}
                                selectVal={selectVal}
                                catalogProductName={binding.catalogProductName}
                                onPick={(r) => {
                                  setLineBindings((prev) => {
                                    const next = [...prev];
                                    while (next.length <= i) {
                                      next.push({
                                        productId: null,
                                        createNew: false,
                                        newName: "",
                                        catalogProductName: null,
                                      });
                                    }
                                    if (r.kind === "new") {
                                      next[i] = {
                                        ...next[i],
                                        createNew: true,
                                        productId: null,
                                        catalogProductName: null,
                                        newName:
                                          next[i]?.newName ||
                                          it.productName ||
                                          "",
                                      };
                                    } else if (r.kind === "none") {
                                      next[i] = {
                                        ...next[i],
                                        createNew: false,
                                        productId: null,
                                        catalogProductName: null,
                                      };
                                    } else {
                                      next[i] = {
                                        ...next[i],
                                        createNew: false,
                                        productId: r.productId,
                                        catalogProductName: r.productName,
                                      };
                                    }
                                    return next;
                                  });
                                }}
                              />
                            ) : null}
                          </div>
                          {binding.createNew && (
                            <div className="space-y-1 pt-1">
                              <Label className="text-xs">
                                Nome do produto a cadastrar
                              </Label>
                              <Input
                                value={binding.newName}
                                onChange={(e) =>
                                  setLineBindings((prev) => {
                                    const next = [...prev];
                                    while (next.length <= i) {
                                      next.push({
                                        productId: null,
                                        createNew: true,
                                        newName: "",
                                        catalogProductName: null,
                                      });
                                    }
                                    next[i] = {
                                      ...next[i],
                                      newName: e.target.value,
                                      createNew: true,
                                    };
                                    return next;
                                  })
                                }
                                placeholder="Ex.: Leite integral 1L"
                              />
                              <p className="text-xs text-muted-foreground">
                                Será criado um produto na sua base com estoque
                                inicial zero; você pode editar depois no Faro.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div>
                          <Label className="text-xs">Qtd</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            autoComplete="off"
                            value={
                              qtyInputs[i] !== undefined
                                ? qtyInputs[i]
                                : formatDecimalPtBrInput(it.quantity, 4)
                            }
                            onChange={(e) => {
                              const raw = sanitizeDecimalPtBrTyping(
                                e.target.value,
                              );
                              setQtyInputs((prev) => {
                                const next = [...prev];
                                next[i] = raw;
                                return next;
                              });
                              const p = parseDecimalPtBrInput(raw);
                              if (p !== null && p > 0) {
                                updateItem(i, { quantity: p });
                              }
                            }}
                            onBlur={(e) => {
                              const raw = sanitizeDecimalPtBrTyping(
                                e.target.value,
                              );
                              const p = parseDecimalPtBrInput(raw);
                              const cur = extracted.items[i];
                              setQtyInputs((prev) => {
                                const next = [...prev];
                                next[i] =
                                  p !== null && p > 0
                                    ? formatDecimalPtBrInput(p, 4)
                                    : formatDecimalPtBrInput(cur.quantity, 4);
                                return next;
                              });
                              if (p !== null && p > 0) {
                                updateItem(i, { quantity: p });
                              }
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Valor unit.</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            autoComplete="off"
                            value={
                              unitInputs[i] !== undefined
                                ? unitInputs[i]
                                : formatDecimalPtBrInput(it.unitValue, 4)
                            }
                            onChange={(e) => {
                              const raw = sanitizeDecimalPtBrTyping(
                                e.target.value,
                              );
                              setUnitInputs((prev) => {
                                const next = [...prev];
                                next[i] = raw;
                                return next;
                              });
                              const p = parseDecimalPtBrInput(raw);
                              if (p !== null && p > 0) {
                                updateItem(i, { unitValue: p });
                              }
                            }}
                            onBlur={(e) => {
                              const raw = sanitizeDecimalPtBrTyping(
                                e.target.value,
                              );
                              const p = parseDecimalPtBrInput(raw);
                              const cur = extracted.items[i];
                              setUnitInputs((prev) => {
                                const next = [...prev];
                                next[i] =
                                  p !== null && p > 0
                                    ? formatDecimalPtBrInput(p, 4)
                                    : formatDecimalPtBrInput(cur.unitValue, 4);
                                return next;
                              });
                              if (p !== null && p > 0) {
                                updateItem(i, { unitValue: p });
                              }
                            }}
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-2 flex items-end text-sm text-muted-foreground">
                          Subtotal: {formatBrl(it.lineTotal)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 py-1">
                      <div
                        className="h-px min-w-0 flex-1 bg-border"
                        aria-hidden
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 max-w-[min(100%,18rem)] shrink gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => insertItemAt(i + 1)}
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          Inserir após o item {i + 1}
                        </span>
                      </Button>
                      <div
                        className="h-px min-w-0 flex-1 bg-border"
                        aria-hidden
                      />
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando…" : "Salvar despesa"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </DraftPageShell>
  );
}

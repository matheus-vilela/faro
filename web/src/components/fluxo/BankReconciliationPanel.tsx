import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  boletoReferenceDate,
  confirmReconciliation,
  fetchImportLines,
  fetchLatestImport,
  fetchPayableBoletosForRecon,
  fetchReconciledBoletoIds,
  markLineCreatedPayable,
  uploadAndImportStatement,
} from "@/lib/bankReconciliation/bankReconciliationApi";
import {
  buildMatchResult,
  type MatchPairSuggestion,
} from "@/lib/bankReconciliation/matchBankLines";
import {
  boletoReconSecondaryLabel,
  boletoReconTitle,
} from "@/lib/boletoFluxoDescription";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyBankAccount } from "@/types/bankAccount";
import { bankAccountTypeLabel } from "@/types/bankAccount";
import type { BankStatementLine } from "@/types/bankReconciliation";
import type { Boleto } from "@/types/expense";
import {
  Check,
  Landmark,
  Loader2,
  Upload,
  HelpCircle,
  Hourglass,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatDateShort(ymd: string) {
  const s = ymd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ymd;
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
}

function boletoSideSub(boleto: Boleto, refDate: string, extra?: string) {
  const parts = [
    boletoReconSecondaryLabel(boleto),
    formatDateShort(refDate),
  ];
  if (extra) parts.push(extra);
  return parts.filter(Boolean).join(" · ");
}

type UiPairRow = {
  key: string;
  kind: "forte" | "provavel";
  pair: MatchPairSuggestion;
  line: BankStatementLine;
  boleto: Boleto;
  done: boolean;
};

type UiRow =
  | UiPairRow
  | {
      key: string;
      kind: "sobanco";
      line: BankStatementLine;
      done: boolean;
    }
  | {
      key: string;
      kind: "sofaro";
      boleto: Boleto;
      done: boolean;
    };

export function BankReconciliationPanel({
  afterHeader,
  embedded = false,
}: {
  afterHeader?: ReactNode;
  /** Sem PageShell/PageHeader — o pai já renderiza o chrome. */
  embedded?: boolean;
}) {
  const { currentCompany } = useCompany();
  const { user } = useAuth();
  const companyId = currentCompany?.id ?? "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [reconciledBoletoIds, setReconciledBoletoIds] = useState<Set<string>>(
    new Set(),
  );
  const [doneKeys, setDoneKeys] = useState<Record<string, string>>({});
  const [fileLabel, setFileLabel] = useState<string | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPair, setReviewPair] = useState<MatchPairSuggestion | null>(null);
  const [reviewInterest, setReviewInterest] = useState("0");
  const [reviewDiscount, setReviewDiscount] = useState("0");
  const [confirming, setConfirming] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createFromLine, setCreateFromLine] = useState<BankStatementLine | null>(
    null,
  );
  const [listPage, setListPage] = useState(1);

  const loadAccounts = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("company_bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (error) {
      console.error(error);
      return;
    }
    const list = (data ?? []) as CompanyBankAccount[];
    setBankAccounts(list);
    if (!accountId && list.length > 0) setAccountId(list[0].id);
  }, [companyId, accountId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const reloadMatchData = useCallback(async () => {
    if (!companyId || !accountId) {
      setLines([]);
      setBoletos([]);
      return;
    }
    setLoading(true);
    try {
      const imp = await fetchLatestImport(companyId, accountId);
      if (!imp) {
        setLines([]);
        setBoletos([]);
        setFileLabel(null);
        return;
      }
      setFileLabel(imp.file_name);
      const allLines = await fetchImportLines(imp.id);
      setLines(allLines);
      const debits = allLines.filter((l) => l.direction === "debit");
      const periodStart =
        imp.period_start ??
        debits[0]?.posted_at ??
        new Date().toISOString().slice(0, 10);
      const periodEnd =
        imp.period_end ??
        debits[debits.length - 1]?.posted_at ??
        periodStart;
      const pays = await fetchPayableBoletosForRecon(
        companyId,
        periodStart,
        periodEnd,
      );
      setBoletos(pays);
      setReconciledBoletoIds(
        await fetchReconciledBoletoIds(
          companyId,
          pays.map((b) => b.id),
        ),
      );
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar a conciliação.");
    } finally {
      setLoading(false);
    }
  }, [companyId, accountId]);

  useEffect(() => {
    void reloadMatchData();
  }, [reloadMatchData]);

  const debitLines = useMemo(
    () => lines.filter((l) => l.direction === "debit"),
    [lines],
  );

  const matchResult = useMemo(() => {
    const unmatchedLines = debitLines.filter(
      (l) => l.status === "unmatched" && !doneKeys[`line:${l.id}`],
    );
    const availableBoletos = boletos.filter((b) => {
      if (reconciledBoletoIds.has(b.id)) return false;
      if (doneKeys[`boleto:${b.id}`]) return false;
      return true;
    });

    return buildMatchResult(
      unmatchedLines.map((l) => ({
        id: l.id,
        postedAt: l.posted_at,
        amount: Number(l.amount),
        description: l.description,
      })),
      availableBoletos.map((b) => ({
        id: b.id,
        description: b.description,
        amount: Number(b.amount),
        referenceDate: boletoReferenceDate(b),
        status: b.status,
        company_category_id: b.company_category_id,
      })),
    );
  }, [debitLines, boletos, doneKeys, reconciledBoletoIds]);

  const lineById = useMemo(() => {
    const m = new Map<string, BankStatementLine>();
    for (const l of lines) m.set(l.id, l);
    return m;
  }, [lines]);

  const boletoById = useMemo(() => {
    const m = new Map<string, Boleto>();
    for (const b of boletos) m.set(b.id, b);
    return m;
  }, [boletos]);

  const rows: UiRow[] = useMemo(() => {
    const out: UiRow[] = [];
    for (const pair of matchResult.pairs) {
      const line = lineById.get(pair.lineId);
      const boleto = boletoById.get(pair.boletoId);
      if (!line || !boleto) continue;
      const key = `pair:${pair.lineId}:${pair.boletoId}`;
      out.push({
        key,
        kind: pair.kind,
        pair,
        line,
        boleto,
        done: !!doneKeys[key],
      });
    }
    for (const id of matchResult.sobancoLineIds) {
      const line = lineById.get(id);
      if (!line) continue;
      const key = `sobanco:${id}`;
      if (doneKeys[key] || line.status !== "unmatched") continue;
      out.push({ key, kind: "sobanco", line, done: !!doneKeys[key] });
    }
    for (const id of matchResult.sofaroBoletoIds) {
      const boleto = boletoById.get(id);
      if (!boleto) continue;
      const key = `sofaro:${id}`;
      out.push({ key, kind: "sofaro", boleto, done: !!doneKeys[key] });
    }
    return out;
  }, [matchResult, lineById, boletoById, doneKeys]);

  const pendingRows = rows.filter((r) => !r.done);
  const matchedCount = rows.length - pendingRows.length;
  const totalMov = rows.length || 1;
  const concilPct = Math.round((matchedCount / totalMov) * 100);
  const safePairs = pendingRows.filter(
    (r): r is UiPairRow & { kind: "forte" } => r.kind === "forte",
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safeListPage = Math.min(listPage, totalPages);
  const pageRows = rows.slice(
    (safeListPage - 1) * PAGE_SIZE,
    safeListPage * PAGE_SIZE,
  );

  useEffect(() => {
    setListPage(1);
  }, [accountId, fileLabel]);

  useEffect(() => {
    if (listPage > totalPages) setListPage(totalPages);
  }, [listPage, totalPages]);

  const diffAmount = useMemo(() => {
    let diff = 0;
    for (const r of pendingRows) {
      if (r.kind === "forte" || r.kind === "provavel") {
        diff += r.pair.amountDiff;
      } else if (r.kind === "sobanco") {
        diff += Number(r.line.amount);
      } else {
        diff += Number(r.boleto.amount);
      }
    }
    return Math.round(diff * 100) / 100;
  }, [pendingRows]);

  const handleFile = async (file: File | null) => {
    if (!file || !companyId || !accountId) {
      toast.error("Selecione uma conta bancária antes de subir o extrato.");
      return;
    }
    setImporting(true);
    try {
      await uploadAndImportStatement({
        companyId,
        companyBankAccountId: accountId,
        file,
        userId: user?.id ?? null,
      });
      setDoneKeys({});
      setListPage(1);
      toast.success("Extrato importado.");
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Falha ao importar o extrato.",
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runConfirm = async (
    pair: MatchPairSuggestion,
    interest: number,
    discount: number,
  ) => {
    if (!companyId || !accountId) return;
    const line = lineById.get(pair.lineId);
    if (!line) return;
    setConfirming(true);
    try {
      await confirmReconciliation({
        companyId,
        userId: user?.id ?? null,
        statementLineId: pair.lineId,
        boletoId: pair.boletoId,
        matchKind: pair.matchKind,
        confidence: pair.confidence,
        amountDiff: pair.amountDiff,
        companyBankAccountId: accountId,
        paymentDate: line.posted_at,
        interestAmount: interest,
        discountAmount: discount,
      });
      const key = `pair:${pair.lineId}:${pair.boletoId}`;
      setDoneKeys((s) => ({
        ...s,
        [key]: "Conciliado",
        [`line:${pair.lineId}`]: "1",
        [`boleto:${pair.boletoId}`]: "1",
      }));
      toast.success("Movimento conciliado.");
      setReviewOpen(false);
      setReviewPair(null);
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível conciliar.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleBulkConfirm = async () => {
    if (!companyId || !accountId || safePairs.length === 0) return;
    setConfirming(true);
    try {
      for (const row of safePairs) {
        const line = lineById.get(row.pair.lineId);
        if (!line) continue;
        await confirmReconciliation({
          companyId,
          userId: user?.id ?? null,
          statementLineId: row.pair.lineId,
          boletoId: row.pair.boletoId,
          matchKind: row.pair.matchKind,
          confidence: row.pair.confidence,
          amountDiff: row.pair.amountDiff,
          companyBankAccountId: accountId,
          paymentDate: line.posted_at,
          interestAmount: 0,
          discountAmount: 0,
        });
        const key = `pair:${row.pair.lineId}:${row.pair.boletoId}`;
        setDoneKeys((s) => ({
          ...s,
          [key]: "Conciliado",
          [`line:${row.pair.lineId}`]: "1",
          [`boleto:${row.pair.boletoId}`]: "1",
        }));
      }
      toast.success("Correspondências fortes confirmadas.");
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Falha ao confirmar em lote.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const openReview = (pair: MatchPairSuggestion) => {
    setReviewPair(pair);
    setReviewInterest(String(pair.suggestedInterest || 0));
    setReviewDiscount(String(pair.suggestedDiscount || 0));
    setReviewOpen(true);
  };

  const insight =
    pendingRows.length === 0 && rows.length > 0
      ? "Conciliação fechada. Cada saída do banco tem um lançamento no Faro."
      : lines.length === 0
        ? "Suba um extrato CSV ou OFX para cruzar com as contas a pagar."
        : `Cruzei o extrato com os lançamentos. ${safePairs.length} correspondência(s) forte(s) pronta(s) para confirmar.`;

  const body = (
    <>
      <div className="flex flex-col gap-3">
        {!embedded && (
          <>
            <PageHeader
              title="Contas a pagar"
              description={insight}
              icon={Landmark}
              className="gap-3 sm:items-center"
            />
            {afterHeader ? (
              <div className="w-fit max-w-full">{afterHeader}</div>
            ) : null}
          </>
        )}
        {embedded && (
          <p className="text-sm text-muted-foreground">{insight}</p>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_minmax(17rem,1.35fr)] xl:items-stretch">
          {/* Conciliado */}
          <div className="flex h-full flex-col justify-between gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Conciliado
              </p>
              <p className="text-sm font-bold tabular-nums text-emerald-500">
                {rows.length === 0 ? "—" : `${concilPct}%`}
              </p>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={rows.length === 0 ? 0 : concilPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{
                  width: `${rows.length === 0 ? 0 : Math.min(100, concilPct)}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {matchedCount} de {rows.length} movimentos
            </p>
          </div>

          {/* A conciliar */}
          <div className="flex h-full flex-col justify-between gap-2 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              A conciliar
            </p>
            <p className="text-4xl font-bold tabular-nums leading-none text-amber-500">
              {pendingRows.length}
            </p>
            <p className="text-xs text-muted-foreground">esperando você</p>
          </div>

          {/* Diferença */}
          <div className="flex h-full flex-col justify-between gap-2 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Diferença
            </p>
            <p
              className={cn(
                "text-3xl font-bold tabular-nums leading-none",
                diffAmount === 0 ? "text-emerald-500" : "text-amber-500",
              )}
            >
              {formatCurrency(diffAmount)}
            </p>
            <p className="text-xs text-muted-foreground">Faro × banco</p>
          </div>

          {/* Extrato */}
          <div className="flex h-full flex-col justify-between gap-2 rounded-xl border border-dashed border-border bg-card/80 p-4 shadow-sm md:col-span-2 xl:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <p className="shrink-0 text-sm font-semibold text-foreground">
                Extrato do banco
              </p>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                  <SelectValue placeholder="Conta" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({bankAccountTypeLabel(a.tipo)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="h-9 min-w-0 flex-1 px-3"
                disabled={importing || !accountId}
                onClick={() => fileRef.current?.click()}
              >
                {importing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4 shrink-0" />
                )}
                <span className="truncate">Subir CSV do extrato</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0 px-2.5 text-xs text-muted-foreground"
                disabled
                title="Em breve"
              >
                Conectar banco · em breve
              </Button>
            </div>
            {fileLabel ? (
              <p className="truncate text-[11px] text-muted-foreground">
                Último: {fileLabel}
              </p>
            ) : (
              <p className="h-[14px]" aria-hidden />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold sm:text-lg">
          Conciliar lançamentos ↔ banco
        </h2>
        {safePairs.length > 0 && (
          <Button
            type="button"
            onClick={() => void handleBulkConfirm()}
            disabled={confirming}
          >
            Confirmar {safePairs.length} correspondência
            {safePairs.length === 1 ? "" : "s"} forte
            {safePairs.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div>Lançado no Faro</div>
        <div className="w-10" />
        <div>Movimentado no banco</div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : pendingRows.length === 0 && rows.length > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Check className="h-10 w-10 text-emerald-600" />
            <p className="text-lg font-semibold">Extrato batido</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Tudo que saiu do banco está lançado no Faro.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum movimento para conciliar. Suba um extrato com débitos.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pageRows.map((row) => (
            <ReconRow
              key={row.key}
              row={row}
              onConfirm={() => {
                if (row.kind === "forte" || row.kind === "provavel") {
                  void runConfirm(
                    row.pair,
                    row.pair.suggestedInterest || 0,
                    row.pair.suggestedDiscount || 0,
                  );
                }
              }}
              onReview={() => {
                if (row.kind === "forte" || row.kind === "provavel") {
                  openReview(row.pair);
                }
              }}
              onCreate={() => {
                if (row.kind === "sobanco") {
                  setCreateFromLine(row.line);
                  setCreateOpen(true);
                }
              }}
              onAwait={() => {
                if (row.kind === "sofaro") {
                  setDoneKeys((s) => ({
                    ...s,
                    [row.key]: "Aguardando",
                    [`boleto:${row.boleto.id}`]: "1",
                  }));
                  toast.message("Mantido como aguardando no banco.");
                }
              }}
              confirming={confirming}
            />
          ))}
          <Pagination
            page={safeListPage}
            totalCount={rows.length}
            onPageChange={setListPage}
          />
        </div>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revisar correspondência</DialogTitle>
            <DialogDescription>
              Ajuste juros ou desconto antes de confirmar a baixa.
            </DialogDescription>
          </DialogHeader>
          {reviewPair && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Faro</p>
                  <p className="font-medium">
                    {(() => {
                      const b = boletoById.get(reviewPair.boletoId);
                      return b ? boletoReconTitle(b) : "—";
                    })()}
                  </p>
                  {(() => {
                    const b = boletoById.get(reviewPair.boletoId);
                    const sec = b ? boletoReconSecondaryLabel(b) : null;
                    return sec ? (
                      <p className="text-xs text-muted-foreground">{sec}</p>
                    ) : null;
                  })()}
                  <p>
                    {formatCurrency(
                      Number(boletoById.get(reviewPair.boletoId)?.amount ?? 0),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Banco</p>
                  <p className="font-medium">
                    {lineById.get(reviewPair.lineId)?.description}
                  </p>
                  <p>
                    {formatCurrency(
                      Number(lineById.get(reviewPair.lineId)?.amount ?? 0),
                    )}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Diferença {formatCurrency(reviewPair.amountDiff)} · confiança{" "}
                {reviewPair.confidence}%
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="recon-interest">Juros</Label>
                  <Input
                    id="recon-interest"
                    value={reviewInterest}
                    onChange={(e) => setReviewInterest(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="recon-discount">Desconto</Label>
                  <Input
                    id="recon-discount"
                    value={reviewDiscount}
                    onChange={(e) => setReviewDiscount(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!reviewPair || confirming}
              onClick={() => {
                if (!reviewPair) return;
                void runConfirm(
                  reviewPair,
                  parseFloat(reviewInterest.replace(",", ".")) || 0,
                  parseFloat(reviewDiscount.replace(",", ".")) || 0,
                );
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateBoletoSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        fixedAccountFlow="payable"
        defaultDueDate={createFromLine?.posted_at}
        defaultAmount={
          createFromLine ? Number(createFromLine.amount) : null
        }
        defaultDescription={createFromLine?.description ?? null}
        onSuccess={(boleto) => {
          if (!createFromLine || !companyId || !accountId) return;
          void (async () => {
            try {
              await markLineCreatedPayable({
                companyId,
                statementLineId: createFromLine.id,
                boletoId: boleto.id,
                userId: user?.id ?? null,
                companyBankAccountId: accountId,
                paymentDate: createFromLine.posted_at,
              });
              setDoneKeys((s) => ({
                ...s,
                [`sobanco:${createFromLine.id}`]: "Lançada",
                [`line:${createFromLine.id}`]: "1",
              }));
              toast.success("Despesa criada a partir do movimento do banco.");
              setCreateFromLine(null);
              await reloadMatchData();
            } catch (e) {
              console.error(e);
              toast.error("Conta criada, mas falhou o vínculo com o extrato.");
            }
          })();
        }}
      />
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4">{body}</div>;
  }

  return <PageShell className="space-y-4">{body}</PageShell>;
}

function ReconRow({
  row,
  onConfirm,
  onReview,
  onCreate,
  onAwait,
  confirming,
}: {
  row: UiRow;
  onConfirm: () => void;
  onReview: () => void;
  onCreate: () => void;
  onAwait: () => void;
  confirming: boolean;
}) {
  const done = row.done;
  const isForte = row.kind === "forte";
  let linkIcon = "=";
  let linkClass = "bg-emerald-500/15 text-emerald-600";
  let left: ReactNode = null;
  let right: ReactNode = null;
  let actions: ReactNode = null;

  if (row.kind === "forte" || row.kind === "provavel") {
    linkIcon = done ? "✓" : isForte ? "=" : "≈";
    linkClass = isForte
      ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30"
      : "bg-amber-500/15 text-amber-600";
    left = (
      <SideCard
        title={boletoReconTitle(row.boleto)}
        sub={boletoSideSub(
          row.boleto,
          boletoReferenceDate(row.boleto),
          row.pair.amountDiff > 0 && !isForte
            ? `dif. ${formatCurrency(row.pair.amountDiff)}`
            : undefined,
        )}
        amount={Number(row.boleto.amount)}
        borderClass={
          isForte && !done
            ? "border-emerald-500/35"
            : isForte
              ? undefined
              : "border-amber-500/40"
        }
      />
    );
    right = (
      <SideCard
        title={row.line.description || "Movimento"}
        sub={`${formatDateShort(row.line.posted_at)}${
          !isForte ? ` · ${row.pair.confidence}%` : ""
        }`}
        amount={Number(row.line.amount)}
        borderClass={
          isForte && !done
            ? "border-emerald-500/35"
            : isForte
              ? undefined
              : "border-amber-500/40"
        }
      />
    );
    actions = done ? (
      <Badge variant="secondary">Conciliado</Badge>
    ) : (
      <div className="flex flex-wrap justify-end gap-2">
        {isForte ? (
          <>
            <Button size="sm" disabled={confirming} onClick={onConfirm}>
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={confirming}
              onClick={onReview}
            >
              Revisar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={confirming}
            onClick={onReview}
          >
            Revisar
          </Button>
        )}
      </div>
    );
  } else if (row.kind === "sobanco") {
    linkIcon = "?";
    linkClass = "bg-destructive/10 text-destructive";
    left = (
      <div className="flex h-full min-w-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs text-muted-foreground">
        sem lançamento no Faro
      </div>
    );
    right = (
      <SideCard
        title={row.line.description || "Movimento"}
        sub={formatDateShort(row.line.posted_at)}
        amount={Number(row.line.amount)}
        borderClass="border-destructive/40"
      />
    );
    actions = done ? (
      <Badge variant="secondary">Lançada</Badge>
    ) : (
      <Button size="sm" onClick={onCreate}>
        Criar despesa
      </Button>
    );
  } else {
    linkIcon = "⌛";
    linkClass = "bg-muted text-muted-foreground";
    left = (
      <SideCard
        title={boletoReconTitle(row.boleto)}
        sub={boletoSideSub(row.boleto, boletoReferenceDate(row.boleto))}
        amount={Number(row.boleto.amount)}
        borderClass="border-muted-foreground/30"
      />
    );
    right = (
      <div className="flex h-full min-w-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs text-muted-foreground">
        não encontrado no banco
      </div>
    );
    actions = done ? (
      <Badge variant="secondary">Aguardando</Badge>
    ) : (
      <Button size="sm" variant="outline" onClick={onAwait}>
        <Hourglass className="mr-1 h-3.5 w-3.5" />
        Aguardando
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "grid items-stretch gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]",
        isForte && !done && "border-emerald-500/40 bg-emerald-500/5",
        done && "opacity-70",
      )}
    >
      {left}
      <div
        className={cn(
          "mx-auto flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full text-sm font-bold",
          linkClass,
        )}
        aria-hidden
      >
        {row.kind === "sofaro" ? (
          <Hourglass className="h-4 w-4" />
        ) : row.kind === "sobanco" ? (
          <HelpCircle className="h-4 w-4" />
        ) : (
          linkIcon
        )}
      </div>
      {right}
      <div className="flex self-center justify-end sm:min-w-[140px]">
        {actions}
      </div>
    </div>
  );
}

function SideCard({
  title,
  sub,
  amount,
  borderClass,
}: {
  title: string;
  sub: string;
  amount: number;
  borderClass?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5",
        borderClass,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-semibold leading-tight" title={title}>
          {title}
        </p>
        {sub ? (
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={sub}
          >
            {sub}
          </p>
        ) : null}
      </div>
      <p className="min-w-[4.5rem] shrink-0 text-right text-sm font-semibold tabular-nums tracking-tight">
        {formatCurrency(amount)}
      </p>
    </div>
  );
}

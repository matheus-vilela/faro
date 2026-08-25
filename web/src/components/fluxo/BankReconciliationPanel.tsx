import { AssociateBoletoDialog } from "@/components/fluxo/AssociateBoletoDialog";
import { CreateBankAccountSheet } from "@/components/CreateBankAccountSheet";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import type { BoletoLaunchType } from "@/components/CreateBoletoSheet";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  fetchAccountStatementLines,
  fetchBoletosByIds,
  fetchBoletosForRecon,
  fetchLatestImport,
  fetchReconciledBoletoIds,
  fetchReconciliationsForLines,
  ignoreStatementLine,
  isIgnoredReconLine,
  isPendingReconLine,
  isReconciledReconLine,
  markLineCreatedPayable,
  restoreIgnoredStatementLine,
  searchBoletosForAssociate,
  suggestLaunchFromStatementHistory,
  undoBankReconciliation,
  uploadAndImportStatement,
} from "@/lib/bankReconciliation/bankReconciliationApi";
import type { LaunchMemorySuggestion } from "@/lib/bankReconciliation/suggestLaunchFromHistory";
import {
  buildMatchResultByDirection,
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
import { isBoletoPayable } from "@/types/expense";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  EyeOff,
  FilePlus,
  HelpCircle,
  Hourglass,
  Landmark,
  Link2,
  Loader2,
  Percent,
  Plus,
  Undo2,
  Upload,
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
  const [reconciledLines, setReconciledLines] = useState<BankStatementLine[]>(
    [],
  );
  const [ignoredLines, setIgnoredLines] = useState<BankStatementLine[]>([]);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [reconBoletoByLineId, setReconBoletoByLineId] = useState<
    Map<string, Boleto>
  >(new Map());
  const [reconciledBoletoIds, setReconciledBoletoIds] = useState<Set<string>>(
    new Set(),
  );
  const [doneKeys, setDoneKeys] = useState<Record<string, string>>({});
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [listTab, setListTab] = useState<"pending" | "done" | "ignored">(
    "pending",
  );

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPair, setReviewPair] = useState<MatchPairSuggestion | null>(null);
  const [reviewInterest, setReviewInterest] = useState("0");
  const [reviewDiscount, setReviewDiscount] = useState("0");
  const [confirming, setConfirming] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createFromLine, setCreateFromLine] = useState<BankStatementLine | null>(
    null,
  );
  const [createIntent, setCreateIntent] = useState<"entry" | "transfer">(
    "entry",
  );
  const [createMemory, setCreateMemory] =
    useState<LaunchMemorySuggestion | null>(null);
  const [createBankOpen, setCreateBankOpen] = useState(false);
  const [listPage, setListPage] = useState(1);

  const [associateOpen, setAssociateOpen] = useState(false);
  const [associateLine, setAssociateLine] = useState<BankStatementLine | null>(
    null,
  );
  const [associateBoletos, setAssociateBoletos] = useState<Boleto[]>([]);
  const [associateLoading, setAssociateLoading] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{
    line: BankStatementLine;
    boleto: Boleto | null;
  } | null>(null);
  const [deleteCreatedLaunch, setDeleteCreatedLaunch] = useState(false);

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

  const handleAccountChange = (value: string) => {
    if (value === "__create__") {
      setCreateBankOpen(true);
      return;
    }
    setAccountId(value);
  };

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const reloadMatchData = useCallback(async () => {
    if (!companyId || !accountId) {
      setLines([]);
      setReconciledLines([]);
      setIgnoredLines([]);
      setBoletos([]);
      setReconBoletoByLineId(new Map());
      return;
    }
    setLoading(true);
    try {
      const [imp, accountLines] = await Promise.all([
        fetchLatestImport(companyId, accountId),
        fetchAccountStatementLines(companyId, accountId),
      ]);
      setFileLabel(imp?.file_name ?? null);
      const pending = accountLines.filter(isPendingReconLine);
      const reconciled = accountLines.filter(isReconciledReconLine);
      const ignored = accountLines.filter(isIgnoredReconLine);
      setLines(pending);
      setReconciledLines(reconciled);
      setIgnoredLines(ignored);

      if (pending.length === 0 && reconciled.length === 0) {
        setBoletos([]);
        setReconBoletoByLineId(new Map());
        setReconciledBoletoIds(new Set());
        return;
      }

      const reconMap = await fetchReconciliationsForLines(
        companyId,
        reconciled.map((l) => l.id),
      );
      const reconBoletoIds = [...reconMap.values()].map((r) => r.boletoId);

      const periodStart =
        pending[0]?.posted_at ??
        reconciled[0]?.posted_at ??
        new Date().toISOString().slice(0, 10);
      const periodEnd =
        pending[pending.length - 1]?.posted_at ??
        reconciled[reconciled.length - 1]?.posted_at ??
        periodStart;
      const pays = (await fetchBoletosForRecon(
        companyId,
        periodStart,
        periodEnd,
      )).filter(isBoletoPayable);
      const extraBoletos = await fetchBoletosByIds(
        companyId,
        reconBoletoIds.filter((id) => !pays.some((b) => b.id === id)),
      );
      const allBoletos = [...pays, ...extraBoletos];
      setBoletos(allBoletos);
      const boletoById = new Map(allBoletos.map((b) => [b.id, b]));
      const linked = new Map<string, Boleto>();
      for (const [lineId, recon] of reconMap) {
        const boleto = boletoById.get(recon.boletoId);
        if (boleto) linked.set(lineId, boleto);
      }
      setReconBoletoByLineId(linked);
      setReconciledBoletoIds(
        await fetchReconciledBoletoIds(
          companyId,
          allBoletos.map((b) => b.id),
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

  const pendingLines = useMemo(
    () =>
      lines.filter((l) => isPendingReconLine(l) && l.direction === "debit"),
    [lines],
  );

  const bankLineCount = pendingLines.length + reconciledLines.length;
  const concilPct =
    bankLineCount === 0
      ? 0
      : Math.round((reconciledLines.length / bankLineCount) * 100);

  const matchResult = useMemo(() => {
    const unmatchedLines = pendingLines.filter(
      (l) => !doneKeys[`line:${l.id}`],
    );
    const availableBoletos = boletos.filter((b) => {
      if (!isBoletoPayable(b)) return false;
      if (reconciledBoletoIds.has(b.id)) return false;
      if (doneKeys[`boleto:${b.id}`]) return false;
      return true;
    });
    const toMatchLine = (l: BankStatementLine) => ({
      id: l.id,
      postedAt: l.posted_at,
      amount: Number(l.amount),
      description: l.description,
    });
    const toMatchBoleto = (b: Boleto) => ({
      id: b.id,
      description: b.description,
      amount: Number(b.amount),
      referenceDate: boletoReferenceDate(b),
      status: b.status,
      company_category_id: b.company_category_id,
    });

    return buildMatchResultByDirection({
      debitLines: unmatchedLines.map(toMatchLine),
      creditLines: [],
      payables: availableBoletos.map(toMatchBoleto),
      receivables: [],
    });
  }, [pendingLines, boletos, doneKeys, reconciledBoletoIds]);

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
      if (doneKeys[key] || !isPendingReconLine(line)) continue;
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
  const safePairs = pendingRows.filter(
    (r): r is UiPairRow & { kind: "forte" } => r.kind === "forte",
  );

  const listLength =
    listTab === "pending"
      ? rows.length
      : listTab === "done"
        ? reconciledLines.length
        : ignoredLines.length;
  const totalPages = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const safeListPage = Math.min(listPage, totalPages);
  const pageRows = rows.slice(
    (safeListPage - 1) * PAGE_SIZE,
    safeListPage * PAGE_SIZE,
  );
  const pageReconciled = reconciledLines.slice(
    (safeListPage - 1) * PAGE_SIZE,
    safeListPage * PAGE_SIZE,
  );
  const pageIgnored = ignoredLines.slice(
    (safeListPage - 1) * PAGE_SIZE,
    safeListPage * PAGE_SIZE,
  );

  useEffect(() => {
    setListPage(1);
  }, [accountId, fileLabel, listTab]);

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
      const imported = await uploadAndImportStatement({
        companyId,
        companyBankAccountId: accountId,
        file,
        userId: user?.id ?? null,
      });
      setDoneKeys({});
      setListPage(1);
      const { insertedCount, skippedCount, ofxLedgerApplied, ofxLedgerAmount } =
        imported;
      if (insertedCount === 0 && skippedCount === 0) {
        toast.message("Nenhum movimento no arquivo.");
      } else if (insertedCount === 0) {
        toast.message("Este extrato já estava importado.");
      } else if (skippedCount > 0) {
        toast.success(
          `${insertedCount} movimento${insertedCount === 1 ? "" : "s"} novo${insertedCount === 1 ? "" : "s"}, ${skippedCount} já estavam no Faro.`,
        );
      } else if (ofxLedgerApplied && ofxLedgerAmount != null) {
        toast.success(
          `Extrato importado. Saldo da conta atualizado para ${formatCurrency(ofxLedgerAmount)}.`,
        );
      } else {
        toast.success("Extrato importado.");
      }
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

  const lineFromRow = (row: UiRow): BankStatementLine | null => {
    if (row.kind === "sofaro") return null;
    return row.line;
  };

  const openCreateFromLine = async (
    line: BankStatementLine,
    intent: "entry" | "transfer",
  ) => {
    if (!companyId) return;
    if (line.status !== "unmatched") {
      toast.error("Este movimento já foi conciliado ou lançado.");
      return;
    }
    setConfirming(true);
    try {
      const memory = await suggestLaunchFromStatementHistory({
        companyId,
        bankDescription: line.description,
        preferEntryKind: intent === "transfer" ? "transfer" : "standard",
        preferFlowType: intent === "transfer" ? undefined : "payable",
      });
      setCreateFromLine(line);
      setCreateIntent(intent);
      setCreateMemory(memory);
      setCreateOpen(true);
    } catch (e) {
      console.error(e);
      setCreateFromLine(line);
      setCreateIntent(intent);
      setCreateMemory(null);
      setCreateOpen(true);
    } finally {
      setConfirming(false);
    }
  };

  const handleAssociateSearch = useCallback(
    async (query: string) => {
      if (!companyId || !associateLine) return;
      setAssociateLoading(true);
      try {
        const found = await searchBoletosForAssociate({
          companyId,
          query,
          flowType: "payable",
          excludeIds: [...reconciledBoletoIds],
        });
        setAssociateBoletos(found);
      } catch (e) {
        console.error(e);
      } finally {
        setAssociateLoading(false);
      }
    },
    [companyId, associateLine, reconciledBoletoIds],
  );

  const openAssociate = (line: BankStatementLine) => {
    setAssociateLine(line);
    setAssociateBoletos([]);
    setAssociateOpen(true);
  };

  const handleAssociateSelect = async (boleto: Boleto) => {
    if (!companyId || !accountId || !associateLine) return;
    const amountDiff = Math.round(
      Math.abs(Number(associateLine.amount) - Number(boleto.amount)) * 100,
    ) / 100;
    setConfirming(true);
    try {
      await confirmReconciliation({
        companyId,
        userId: user?.id ?? null,
        statementLineId: associateLine.id,
        boletoId: boleto.id,
        matchKind: "manual",
        confidence: null,
        amountDiff,
        companyBankAccountId: accountId,
        paymentDate: associateLine.posted_at,
      });
      setDoneKeys((s) => ({
        ...s,
        [`line:${associateLine.id}`]: "1",
        [`boleto:${boleto.id}`]: "1",
        [`sobanco:${associateLine.id}`]: "Conciliado",
        [`pair:${associateLine.id}:${boleto.id}`]: "Conciliado",
      }));
      toast.success("Movimento associado ao lançamento.");
      setAssociateOpen(false);
      setAssociateLine(null);
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível associar.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleIgnoreLine = async (line: BankStatementLine) => {
    if (!companyId) return;
    setConfirming(true);
    try {
      await ignoreStatementLine({
        companyId,
        statementLineId: line.id,
      });
      setDoneKeys((s) => ({
        ...s,
        [`sobanco:${line.id}`]: "Ignorado",
        [`line:${line.id}`]: "1",
      }));
      toast.success("Movimento ignorado. Restaure em Ignorados se foi engano.");
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível ignorar.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleRestoreIgnored = async (line: BankStatementLine) => {
    if (!companyId) return;
    setConfirming(true);
    try {
      await restoreIgnoredStatementLine({
        companyId,
        statementLineId: line.id,
      });
      setDoneKeys((s) => {
        const next = { ...s };
        delete next[`sobanco:${line.id}`];
        delete next[`line:${line.id}`];
        return next;
      });
      toast.success("Movimento restaurado. Ele voltou para a fila.");
      setListTab("pending");
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível restaurar.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const openUndo = (line: BankStatementLine) => {
    setUndoTarget({
      line,
      boleto: reconBoletoByLineId.get(line.id) ?? null,
    });
    setDeleteCreatedLaunch(false);
  };

  const handleUndoRecon = async () => {
    if (!companyId || !undoTarget) return;
    const deleteCreated =
      deleteCreatedLaunch && undoTarget.line.status === "created_payable";
    setConfirming(true);
    try {
      await undoBankReconciliation({
        companyId,
        statementLineId: undoTarget.line.id,
        deleteCreatedLaunch: deleteCreated,
      });
      toast.success(
        deleteCreated
          ? "Lançamento removido da conciliação e do Faro."
          : "Conciliação desfeita. O movimento voltou para a fila.",
      );
      setUndoTarget(null);
      setDeleteCreatedLaunch(false);
      await reloadMatchData();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível desfazer.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const createDefaultFlow = "payable" as const;
  const createLaunchType: BoletoLaunchType =
    createIntent === "transfer" ? "transfer" : "single";
  const createOriginAccount =
    createIntent === "transfer"
      ? createFromLine?.direction === "credit"
        ? (createMemory?.originBankAccountId ?? "")
        : accountId
      : (createMemory?.originBankAccountId ?? "");
  const createDestAccount =
    createIntent === "transfer"
      ? createFromLine?.direction === "credit"
        ? accountId
        : (createMemory?.destBankAccountId ?? "")
      : (createMemory?.destBankAccountId ?? "");

  const insight =
    pendingRows.length === 0 && bankLineCount > 0
      ? "Conciliação fechada. Cada movimento do banco tem um lançamento no Faro."
      : bankLineCount === 0
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
                {bankLineCount === 0 ? "—" : `${concilPct}%`}
              </p>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={bankLineCount === 0 ? 0 : concilPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{
                  width: `${bankLineCount === 0 ? 0 : Math.min(100, concilPct)}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {reconciledLines.length} de {bankLineCount} movimentos
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
              <Select
                value={accountId === "__create__" ? "" : accountId}
                onValueChange={handleAccountChange}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                  <SelectValue placeholder="Conta" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({bankAccountTypeLabel(a.tipo)})
                    </SelectItem>
                  ))}
                  <SelectItem
                    value="__create__"
                    className="text-primary font-medium"
                  >
                    <Plus className="mr-2 inline h-3.5 w-3.5" />
                    Criar conta bancária
                  </SelectItem>
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
            {bankAccounts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Nenhuma conta ainda.{" "}
                <button
                  type="button"
                  onClick={() => setCreateBankOpen(true)}
                  className="text-primary underline"
                >
                  Criar conta bancária
                </button>
              </p>
            ) : fileLabel ? (
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold sm:text-lg">
            Conciliar lançamentos ↔ banco
          </h2>
          <div className="flex rounded-lg border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={listTab === "pending" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setListTab("pending")}
            >
              A conciliar ({pendingRows.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={listTab === "done" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setListTab("done")}
            >
              Conciliados ({reconciledLines.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={listTab === "ignored" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setListTab("ignored")}
            >
              Ignorados ({ignoredLines.length})
            </Button>
          </div>
        </div>
        {listTab === "pending" && safePairs.length > 0 && (
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
      ) : listTab === "ignored" ? (
        ignoredLines.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhum movimento ignorado. Eles não voltam ao reenviar o extrato —
              restaure aqui se foi engano.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pageIgnored.map((line) => (
              <IgnoredRow
                key={line.id}
                line={line}
                confirming={confirming}
                onRestore={() => void handleRestoreIgnored(line)}
              />
            ))}
            <Pagination
              page={safeListPage}
              totalCount={ignoredLines.length}
              onPageChange={setListPage}
            />
          </div>
        )
      ) : listTab === "done" ? (
        reconciledLines.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhum movimento conciliado ainda.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pageReconciled.map((line) => {
              const boleto = reconBoletoByLineId.get(line.id) ?? null;
              return (
                <ReconciledRow
                  key={line.id}
                  line={line}
                  boleto={boleto}
                  confirming={confirming}
                  onUndo={() => openUndo(line)}
                />
              );
            })}
            <Pagination
              page={safeListPage}
              totalCount={reconciledLines.length}
              onPageChange={setListPage}
            />
          </div>
        )
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
      ) : pendingRows.length === 0 && bankLineCount > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Check className="h-10 w-10 text-emerald-600" />
            <p className="text-lg font-semibold">Extrato batido</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Tudo que saiu do banco está lançado no Faro. Veja em
              Conciliados se precisar desfazer
              {ignoredLines.length > 0
                ? ", ou em Ignorados para restaurar um movimento."
                : "."}
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {ignoredLines.length > 0
              ? "Nada na fila. Há movimentos em Ignorados — restaure se quiser conciliar."
              : "Nenhum movimento para conciliar. Suba um extrato CSV ou OFX."}
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
              onReviewInterest={() => {
                if (row.kind === "forte" || row.kind === "provavel") {
                  openReview(row.pair);
                }
              }}
              onLaunchEntry={() => {
                const line = lineFromRow(row);
                if (line) void openCreateFromLine(line, "entry");
              }}
              onLaunchTransfer={() => {
                const line = lineFromRow(row);
                if (line) void openCreateFromLine(line, "transfer");
              }}
              onAssociate={() => {
                const line = lineFromRow(row);
                if (line) openAssociate(line);
              }}
              onIgnore={() => {
                const line = lineFromRow(row);
                if (line) void handleIgnoreLine(line);
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
        key={
          createOpen
            ? `${createFromLine?.id ?? "line"}-${createIntent}`
            : "closed"
        }
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) {
            setCreateFromLine(null);
            setCreateMemory(null);
          }
        }}
        companyId={companyId}
        fixedAccountFlow={
          createIntent === "transfer" ? undefined : createDefaultFlow
        }
        defaultAccountFlow={createDefaultFlow}
        defaultLaunchType={createLaunchType}
        defaultCategoryId={
          createIntent === "transfer"
            ? null
            : (createMemory?.companyCategoryId ?? null)
        }
        defaultOriginBankAccountId={createOriginAccount || null}
        defaultDestBankAccountId={createDestAccount || null}
        defaultDueDate={createFromLine?.posted_at}
        defaultAmount={
          createFromLine ? Number(createFromLine.amount) : null
        }
        defaultDescription={
          createMemory?.description ?? createFromLine?.description ?? null
        }
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
                statementDirection: createFromLine.direction,
              });
              setDoneKeys((s) => ({
                ...s,
                [`sobanco:${createFromLine.id}`]: "Lançada",
                [`line:${createFromLine.id}`]: "1",
              }));
              toast.success("Lançamento criado a partir do movimento do banco.");
              setCreateFromLine(null);
              setCreateMemory(null);
              await reloadMatchData();
            } catch (e) {
              console.error(e);
              toast.error("Conta criada, mas falhou o vínculo com o extrato.");
            }
          })();
        }}
      />

      <AssociateBoletoDialog
        open={associateOpen}
        onOpenChange={setAssociateOpen}
        loading={associateLoading}
        confirming={confirming}
        boletos={associateBoletos}
        onSearch={handleAssociateSearch}
        onSelect={(b) => {
          void handleAssociateSelect(b);
        }}
      />

      <CreateBankAccountSheet
        open={createBankOpen}
        onOpenChange={setCreateBankOpen}
        companyId={companyId}
        onSuccess={(account) => {
          setBankAccounts((prev) =>
            [...prev.filter((a) => a.id !== account.id), account].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR"),
            ),
          );
          setAccountId(account.id);
        }}
      />

      <AlertDialog
        open={undoTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setUndoTarget(null);
            setDeleteCreatedLaunch(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer conciliação?</AlertDialogTitle>
            <AlertDialogDescription>
              O movimento do banco volta para a fila. A conta no Faro volta a
              em aberto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {undoTarget?.line.status === "created_payable" ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={deleteCreatedLaunch}
                onCheckedChange={(checked) => setDeleteCreatedLaunch(checked)}
                className="mt-0.5"
              />
              <span>
                Excluir também o lançamento criado nesta conciliação.
              </span>
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirming}
              onClick={(e) => {
                e.preventDefault();
                void handleUndoRecon();
              }}
            >
              {deleteCreatedLaunch &&
              undoTarget?.line.status === "created_payable"
                ? "Excluir lançamento"
                : "Desfazer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4">{body}</div>;
  }

  return <PageShell className="space-y-4">{body}</PageShell>;
}

function RevisarMenu({
  confirming,
  showInterest,
  onReviewInterest,
  onLaunchEntry,
  onLaunchTransfer,
  onAssociate,
  onIgnore,
}: {
  confirming: boolean;
  showInterest: boolean;
  onReviewInterest: () => void;
  onLaunchEntry: () => void;
  onLaunchTransfer: () => void;
  onAssociate: () => void;
  onIgnore: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={confirming}>
          Revisar
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {showInterest ? (
          <>
            <DropdownMenuItem onClick={onReviewInterest}>
              <Percent className="h-4 w-4" />
              Ajustar juros e desconto
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={onLaunchEntry}>
          <FilePlus className="h-4 w-4" />
          Adicionar como novo lançamento
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLaunchTransfer}>
          <ArrowLeftRight className="h-4 w-4" />
          Adicionar como transferência
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAssociate}>
          <Link2 className="h-4 w-4" />
          Buscar e associar a um lançamento
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onIgnore}>
          <EyeOff className="h-4 w-4" />
          Ignorar movimento do banco
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReconRow({
  row,
  onConfirm,
  onReviewInterest,
  onLaunchEntry,
  onLaunchTransfer,
  onAssociate,
  onIgnore,
  onAwait,
  confirming,
}: {
  row: UiRow;
  onConfirm: () => void;
  onReviewInterest: () => void;
  onLaunchEntry: () => void;
  onLaunchTransfer: () => void;
  onAssociate: () => void;
  onIgnore: () => void;
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

  const revisarMenu = (
    <RevisarMenu
      confirming={confirming}
      showInterest={row.kind === "forte" || row.kind === "provavel"}
      onReviewInterest={onReviewInterest}
      onLaunchEntry={onLaunchEntry}
      onLaunchTransfer={onLaunchTransfer}
      onAssociate={onAssociate}
      onIgnore={onIgnore}
    />
  );

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
          row.line.direction === "credit" ? " · entrada" : " · saída"
        }${!isForte ? ` · ${row.pair.confidence}%` : ""}`}
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
        <Button size="sm" disabled={confirming} onClick={onConfirm}>
          Confirmar
        </Button>
        {revisarMenu}
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
        sub={`${formatDateShort(row.line.posted_at)}${
          row.line.direction === "credit" ? " · entrada" : " · saída"
        }`}
        amount={Number(row.line.amount)}
        borderClass="border-destructive/40"
      />
    );
    actions = done ? (
      <Badge variant="secondary">Lançada</Badge>
    ) : (
      revisarMenu
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
      <div className="flex self-center justify-end sm:min-w-[200px]">
        {actions}
      </div>
    </div>
  );
}

function ReconciledRow({
  line,
  boleto,
  confirming,
  onUndo,
}: {
  line: BankStatementLine;
  boleto: Boleto | null;
  confirming: boolean;
  onUndo: () => void;
}) {
  const created = line.status === "created_payable";
  return (
    <div className="grid items-stretch gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      {boleto ? (
        <SideCard
          title={boletoReconTitle(boleto)}
          sub={boletoSideSub(boleto, boletoReferenceDate(boleto))}
          amount={Number(boleto.amount)}
        />
      ) : (
        <div className="flex h-full min-w-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs text-muted-foreground">
          lançamento não encontrado
        </div>
      )}
      <div
        className="mx-auto flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-600"
        aria-hidden
      >
        ✓
      </div>
      <SideCard
        title={line.description || "Movimento"}
        sub={`${formatDateShort(line.posted_at)}${
          line.direction === "credit" ? " · entrada" : " · saída"
        }${created ? " · lançado aqui" : ""}`}
        amount={Number(line.amount)}
      />
      <div className="flex self-center justify-end sm:min-w-[168px]">
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onUndo}
        >
          <Undo2 className="mr-1 h-3.5 w-3.5" />
          Desfazer
        </Button>
      </div>
    </div>
  );
}

function IgnoredRow({
  line,
  confirming,
  onRestore,
}: {
  line: BankStatementLine;
  confirming: boolean;
  onRestore: () => void;
}) {
  return (
    <div className="grid items-stretch gap-2 rounded-xl border bg-card p-3 opacity-80 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      <div className="flex h-full min-w-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs text-muted-foreground">
        ignorado no Faro
      </div>
      <div
        className="mx-auto flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <EyeOff className="h-4 w-4" />
      </div>
      <SideCard
        title={line.description || "Movimento"}
        sub={`${formatDateShort(line.posted_at)}${
          line.direction === "credit" ? " · entrada" : " · saída"
        }`}
        amount={Number(line.amount)}
      />
      <div className="flex self-center justify-end sm:min-w-[168px]">
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onRestore}
        >
          <Undo2 className="mr-1 h-3.5 w-3.5" />
          Restaurar
        </Button>
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

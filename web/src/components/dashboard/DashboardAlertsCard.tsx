import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DashboardImportReviewProductCadastroModal } from "@/components/dashboard/DashboardImportReviewProductCadastroModal";
import { ImportPendingProductMatchDetail } from "@/components/dashboard/ImportPendingProductMatchDetail";
import { useCompany } from "@/contexts/CompanyContext";
import {
  buildProductUnitSelectOptions,
  isSystemUnitCode,
  type CompanyUnitAliasRow,
} from "@/lib/companyUnits/productUnitOptions";
import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import { OPERATIONAL_ITEM_TYPES } from "@/lib/itemClassification/operationalItemTypes";
import {
  importPendingReasonBadgeLabel,
  readPendingPayloadReasonCode,
} from "@/lib/importPending/pendingReasonUi";
import { DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT } from "@/lib/dashboardImportReviewUi";
import {
  canonicalProductName,
  normalizeInvoiceProductLabel,
} from "@/lib/productImport/canonicalName";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  PackageX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type PendingRow = {
  id: string;
  kind: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  title: string;
  detail: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  expense_id: string | null;
  expense_item_id: string | null;
};

type PendingProductRow = {
  id: string;
  name: string;
  unit: string | null;
  import_unit_raw: string | null;
};

type PendingProductConfigRow = {
  product_id: string;
  suggested_operational_type: OperationalItemType | null;
  suggested_score: number | null;
  suggestion_reasons: Record<string, unknown> | null;
  final_operational_type: OperationalItemType | null;
  linked_entry_breakdown_recipe_id: string | null;
  configuration_status: string | null;
};

const TYPE_LABEL: Record<OperationalItemType, string> = {
  INSUMO: "Insumo",
  PRODUTO_REVENDA: "Revenda",
  ITEM_OPERACIONAL: "Operacional",
  RECEITA_FICHA: "Receita / ficha (entrada)",
  NAO_ESTOCAVEL: "Não estocável",
  REVISAO_PENDENTE: "Revisar",
};

function normalizeCustomUnitCode(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

function readPayloadProductId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const ownTarget = String(
    payload.target_product_id ?? payload.product_id ?? payload.productId ?? "",
  ).trim();
  if (ownTarget) return ownTarget;
  const match = payload.productMatch as Record<string, unknown> | undefined;
  const nested = String(match?.resolvedProductId ?? match?.suggestedProductId ?? "").trim();
  return nested || null;
}

function readPayloadUnitRaw(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  return String(payload.unitCommercial ?? payload.unit_trib ?? payload.unit ?? "").trim();
}

function readPayloadCandidateProductIds(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload.candidate_product_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter(Boolean);
}

function readSuggestedCatalogName(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  return String(payload.suggested_catalog_name ?? "").trim();
}

function readPayloadXmlProductName(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  return String(payload.xml_product_name ?? "").trim();
}

export function DashboardAlertsCard({
  loading,
  totalAlerts,
  lowStock,
  withoutBoleto,
  notReceived,
  boletoD3,
  boletoD1,
  importPending,
  onAfterImportSheetClose,
}: {
  loading: boolean;
  totalAlerts: number;
  lowStock: number;
  withoutBoleto: number;
  notReceived: number;
  boletoD3: number;
  boletoD1: number;
  importPending: number;
  /** Recarrega totais do dashboard ao fechar o sheet (ex.: após resolver pendências). */
  onAfterImportSheetClose?: () => void;
}) {
  const { currentCompany } = useCompany();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState<"all" | "OPEN" | "RESOLVED" | "IGNORED">("OPEN");
  const [kind, setKind] = useState<string>("all");
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(importPending);
  const [pendingProducts, setPendingProducts] = useState<Record<string, PendingProductRow>>({});
  const [pendingProductConfigs, setPendingProductConfigs] = useState<Record<string, PendingProductConfigRow>>({});
  const [customUnitAliasOptions, setCustomUnitAliasOptions] = useState<CompanyUnitAliasRow[]>([]);
  const [createUnitTargetProductId, setCreateUnitTargetProductId] = useState<string | null>(null);
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitLabel, setNewUnitLabel] = useState("");
  const [savingNewUnit, setSavingNewUnit] = useState(false);
  const [cadastroProductId, setCadastroProductId] = useState<string | null>(null);

  const loadPendingRows = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoadingPending(true);
    let q = supabase
      .from("import_review_pending")
      .select("id, kind, status, title, detail, payload, created_at, expense_id, expense_item_id")
      .eq("company_id", currentCompany.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (status !== "all") q = q.eq("status", status);
    if (kind !== "all") q = q.eq("kind", kind);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      q,
      supabase
        .from("import_review_pending")
        .select("id", { count: "exact", head: true })
        .eq("company_id", currentCompany.id)
        .eq("status", "OPEN"),
    ]);
    setLoadingPending(false);

    if (error || countError) {
      return;
    }
    const nextRows = (data ?? []) as PendingRow[];
    setRows(nextRows);
    setPendingCount(count ?? 0);

    const openRows = nextRows.filter((r) => r.status === "OPEN");
    const productIds = Array.from(
      new Set(
        openRows
          .map((r) => readPayloadProductId(r.payload))
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const candIds = Array.from(
      new Set(openRows.flatMap((r) => readPayloadCandidateProductIds(r.payload))),
    );
    const productIdsMerged = Array.from(new Set([...productIds, ...candIds]));

    const [productsRes, configsRes, unitsRes] = await Promise.all([
      productIdsMerged.length > 0
        ? supabase
            .from("products")
            .select("id, name, unit, import_unit_raw")
            .in("id", productIdsMerged)
        : Promise.resolve({ data: [] as PendingProductRow[], error: null }),
      productIdsMerged.length > 0
        ? supabase
            .from("product_operational_config")
            .select(
              "product_id, suggested_operational_type, suggested_score, suggestion_reasons, final_operational_type, linked_entry_breakdown_recipe_id, configuration_status",
            )
            .eq("company_id", currentCompany.id)
            .in("product_id", productIdsMerged)
        : Promise.resolve({ data: [] as PendingProductConfigRow[], error: null }),
      supabase
        .from("company_custom_unit_aliases")
        .select("unit_code, unit_label")
        .eq("company_id", currentCompany.id)
        .order("unit_label", { ascending: true }),
    ]);

    if (!productsRes.error) {
      const map: Record<string, PendingProductRow> = {};
      for (const raw of productsRes.data ?? []) {
        const row = raw as PendingProductRow;
        map[row.id] = row;
      }
      setPendingProducts(map);
    } else {
      setPendingProducts({});
    }
    if (!configsRes.error) {
      const map: Record<string, PendingProductConfigRow> = {};
      for (const raw of configsRes.data ?? []) {
        const row = raw as PendingProductConfigRow;
        map[row.product_id] = row;
      }
      setPendingProductConfigs(map);
    } else {
      setPendingProductConfigs({});
    }
    if (!unitsRes.error) {
      setCustomUnitAliasOptions((unitsRes.data ?? []) as CompanyUnitAliasRow[]);
    }
  }, [currentCompany?.id, kind, status]);

  useEffect(() => {
    setPendingCount(importPending);
  }, [importPending]);

  useEffect(() => {
    const open = () => setSheetOpen(true);
    window.addEventListener(DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT, open);
    return () =>
      window.removeEventListener(DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT, open);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    void loadPendingRows();
  }, [loadPendingRows, sheetOpen]);

  const closePending = async (id: string, next: "RESOLVED" | "IGNORED") => {
    const previous = rows;
    setBusy(id);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status: next } : row)));
    setPendingCount((current) => Math.max(0, current - 1));

    const { error } = await supabase
      .from("import_review_pending")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);

    setBusy(null);
    if (error) {
      setRows(previous);
      setPendingCount((current) => current + 1);
      return;
    }
  };

  const applyLinkCandidateAndResolve = useCallback(
    async (row: PendingRow, linkProductId: string) => {
      if (!currentCompany?.id || !row.expense_item_id) return;
      const xmlLine =
        readPayloadXmlProductName(row.payload) ||
        readSuggestedCatalogName(row.payload) ||
        row.title;
      setBusy(row.id);
      try {
        const prodRow = pendingProducts[linkProductId];
        const displayName = prodRow?.name?.trim() || "Produto";
        const { error: upErr } = await supabase
          .from("expense_items")
          .update({
            product_id: linkProductId,
            product_name: displayName,
            import_pending_resolution: false,
            import_engine_suggestion: "XML_CATALOG_DASHBOARD_LINK",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.expense_item_id);
        if (upErr) throw upErr;

        const nl = normalizeInvoiceProductLabel(xmlLine);
        if (nl) {
          const { error: alErr } = await supabase.from("product_invoice_line_aliases").upsert(
            {
              company_id: currentCompany.id,
              normalized_label: nl,
              product_id: linkProductId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "company_id,normalized_label" },
          );
          if (alErr) {
            console.warn("[DashboardAlertsCard] alias upsert:", alErr.message);
          }
        }

        const { error: pendErr } = await supabase
          .from("import_review_pending")
          .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (pendErr) throw pendErr;

        setRows((cur) => cur.filter((x) => x.id !== row.id));
        setPendingCount((c) => Math.max(0, c - 1));
        toast.success("Produto vinculado à linha.");
        void loadPendingRows();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível vincular.");
      } finally {
        setBusy(null);
      }
    },
    [currentCompany?.id, loadPendingRows, pendingProducts],
  );

  const createSuggestedProductAndResolve = useCallback(
    async (row: PendingRow) => {
      if (!currentCompany?.id || !row.expense_item_id) return;
      const suggested =
        readSuggestedCatalogName(row.payload) ||
        readPayloadXmlProductName(row.payload) ||
        row.title;
      const name = suggested.trim().slice(0, 512);
      if (!name) {
        toast.error("Sem nome sugerido para cadastro.");
        return;
      }
      const pm = row.payload?.productMatch as Record<string, unknown> | undefined;
      const invU = String(pm?.invoiceUnitNormalized ?? "").trim().toLowerCase();
      const unit =
        invU && invU !== "unkn" && invU.length <= 32 ? invU : "un";
      const cn = canonicalProductName(name) || null;

      setBusy(row.id);
      try {
        if (cn) {
          const { data: dup } = await supabase
            .from("products")
            .select("id")
            .eq("company_id", currentCompany.id)
            .eq("canonical_name", cn)
            .eq("is_active", true)
            .maybeSingle();
          if (dup?.id) {
            await applyLinkCandidateAndResolve(row, String(dup.id));
            return;
          }
        }

        const { data: ins, error: insErr } = await supabase
          .from("products")
          .insert({
            company_id: currentCompany.id,
            name,
            unit,
            canonical_name: cn,
            min_quantity: 0,
            current_quantity: 0,
            is_active: true,
            stock_control_type: "DIRECT",
          })
          .select("id")
          .single();
        if (insErr || !ins?.id) throw new Error(insErr?.message ?? "Falha ao criar produto.");

        const newId = String(ins.id);
        const { error: upErr } = await supabase
          .from("expense_items")
          .update({
            product_id: newId,
            product_name: name,
            import_pending_resolution: false,
            import_engine_suggestion: "XML_CATALOG_DASHBOARD_NEW_PRODUCT",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.expense_item_id);
        if (upErr) throw upErr;

        const xmlLine =
          readPayloadXmlProductName(row.payload) || readSuggestedCatalogName(row.payload) || row.title;
        const nl = normalizeInvoiceProductLabel(xmlLine);
        if (nl) {
          const { error: alErr } = await supabase.from("product_invoice_line_aliases").upsert(
            {
              company_id: currentCompany.id,
              normalized_label: nl,
              product_id: newId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "company_id,normalized_label" },
          );
          if (alErr) {
            console.warn("[DashboardAlertsCard] alias upsert:", alErr.message);
          }
        }

        const { error: pendErr } = await supabase
          .from("import_review_pending")
          .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (pendErr) throw pendErr;

        setRows((cur) => cur.filter((x) => x.id !== row.id));
        setPendingCount((c) => Math.max(0, c - 1));
        toast.success("Produto criado e linha vinculada.");
        void loadPendingRows();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível criar o produto.");
      } finally {
        setBusy(null);
      }
    },
    [applyLinkCandidateAndResolve, currentCompany?.id, loadPendingRows],
  );

  const displayedPendingCount = useMemo(() => Math.max(0, pendingCount), [pendingCount]);

  const persistProductUnit = useCallback(async (productId: string, unit: string) => {
    const normalized = unit.trim().toLowerCase();
    if (!normalized) return;
    setBusyProductId(productId);
    const { error } = await supabase
      .from("products")
      .update({ unit: normalized, updated_at: new Date().toISOString() })
      .eq("id", productId);
    setBusyProductId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPendingProducts((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] ?? { id: productId, name: "Produto", unit: null, import_unit_raw: null }),
        unit: normalized,
      },
    }));
    toast.success("Unidade atualizada.");
  }, []);

  const persistProductType = useCallback(async (productId: string, nextType: OperationalItemType) => {
    if (!currentCompany?.id) return;
    const prev = pendingProductConfigs[productId];
    setBusyProductId(productId);
    const { data, error } = await supabase.rpc("upsert_product_operational_config", {
      p_product_id: productId,
      p_suggested_operational_type: prev?.suggested_operational_type ?? nextType,
      p_suggested_score: prev?.suggested_score ?? 0.5,
      p_suggestion_reasons: prev?.suggestion_reasons ?? { source: "dashboard_pending_sheet" },
      p_final_operational_type: nextType,
      p_final_decision_source: "USER_EDITED",
      p_configuration_status: prev?.configuration_status ?? "PENDENTE",
      p_configuration_completeness: { from: "dashboard_pending_sheet" },
      p_linked_entry_breakdown_recipe_id:
        nextType === "RECEITA_FICHA" ? (prev?.linked_entry_breakdown_recipe_id ?? null) : null,
      p_notes: null,
      p_ui_filter_json: { source: "dashboard_alerts_card" },
    });
    setBusyProductId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const out = data as { ok?: boolean; error?: string } | null;
    if (!out?.ok) {
      toast.error(out?.error ?? "Falha ao salvar tipo.");
      return;
    }
    setPendingProductConfigs((prevMap) => ({
      ...prevMap,
      [productId]: {
        ...(prevMap[productId] ?? {
          product_id: productId,
          suggested_operational_type: nextType,
          suggested_score: 0.5,
          suggestion_reasons: { source: "dashboard_pending_sheet" },
          linked_entry_breakdown_recipe_id: null,
          configuration_status: "PENDENTE",
          final_operational_type: null,
        }),
        final_operational_type: nextType,
      },
    }));
    toast.success("Tipo atualizado.");
  }, [currentCompany?.id, pendingProductConfigs]);

  const openCreateUnitDialog = useCallback((productId: string) => {
    const current = pendingProducts[productId];
    const raw = (current?.unit ?? "").trim();
    setNewUnitCode(raw ? normalizeCustomUnitCode(raw) || raw.toLowerCase() : "");
    setNewUnitLabel("");
    setCreateUnitTargetProductId(productId);
  }, [pendingProducts]);

  const handleSaveNewCustomUnit = useCallback(async () => {
    if (!currentCompany?.id || !createUnitTargetProductId) return;
    const code = normalizeCustomUnitCode(newUnitCode);
    const label = newUnitLabel.trim();
    if (!code) {
      toast.error("Informe um código de unidade (ex.: vidro, fd, cx2).");
      return;
    }
    if (!label) {
      toast.error("Informe o nome da unidade.");
      return;
    }
    if (isSystemUnitCode(code)) {
      setCreateUnitTargetProductId(null);
      void persistProductUnit(createUnitTargetProductId, code);
      return;
    }
    setSavingNewUnit(true);
    const sourceHint = (pendingProducts[createUnitTargetProductId]?.unit ?? "").trim() || code;
    const { data, error } = await supabase.rpc("register_company_custom_unit_alias", {
      p_company_id: currentCompany.id,
      p_unit_label: label,
      p_unit_code: code,
      p_source_hint: sourceHint,
      p_apply_to_existing: true,
    });
    if (error) {
      const { error: fallbackError } = await supabase
        .from("company_custom_unit_aliases")
        .upsert(
          {
            company_id: currentCompany.id,
            unit_code: code,
            unit_label: label,
            source_hint: sourceHint,
          },
          { onConflict: "company_id,unit_code" },
        );
      if (fallbackError) {
        setSavingNewUnit(false);
        toast.error(`Falha ao registrar unidade: ${fallbackError.message}`);
        return;
      }
    } else {
      const payload = data as { ok?: boolean; error?: string } | null;
      if (!payload?.ok) {
        setSavingNewUnit(false);
        toast.error(payload?.error ?? "Não foi possível registrar a unidade.");
        return;
      }
    }
    await persistProductUnit(createUnitTargetProductId, code);
    const { data: units } = await supabase
      .from("company_custom_unit_aliases")
      .select("unit_code, unit_label")
      .eq("company_id", currentCompany.id)
      .order("unit_label", { ascending: true });
    setCustomUnitAliasOptions((units ?? []) as CompanyUnitAliasRow[]);
    setSavingNewUnit(false);
    setCreateUnitTargetProductId(null);
  }, [
    createUnitTargetProductId,
    currentCompany?.id,
    newUnitCode,
    newUnitLabel,
    pendingProducts,
    persistProductUnit,
  ]);

  return (
    <>
      {currentCompany?.id ? (
        <DashboardImportReviewProductCadastroModal
          companyId={currentCompany.id}
          productId={cadastroProductId}
          open={cadastroProductId !== null}
          onOpenChange={(o) => {
            if (!o) setCadastroProductId(null);
          }}
          onSaved={() => void loadPendingRows()}
        />
      ) : null}
    <Card className="overflow-hidden border-l-4 border-l-amber-500/80 shadow-sm ring-1 ring-border/60">
      <CardHeader className="border-b border-border/50 bg-linear-to-br from-amber-500/[0.07] to-transparent pb-4 dark:from-amber-500/12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400">
              <Bell className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold tracking-tight">
                Alertas da operação
              </CardTitle>
              <CardDescription className="mt-1">
                Estoque, recebimentos e despesas — toque para abrir só aquele
                tipo.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link to="/app/alertas">
              Ver todos
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando alertas…
          </div>
        ) : totalAlerts === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/25 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum alerta aberto. Boa conferência.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            <li>
              <Sheet
                open={sheetOpen}
                onOpenChange={(open) => {
                  setSheetOpen(open);
                  if (!open) onAfterImportSheetClose?.();
                }}
              >
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                        <Bell className="h-4 w-4" />
                      </span>
                      <span className="truncate">Pendências da importação</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                      {displayedPendingCount}
                    </span>
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
                  <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle>Central de pendências</SheetTitle>
                    <SheetDescription>
                      Confira vínculos entre a NF e o catálogo. Também abre em{" "}
                      <strong>Revisão pós-importação → Abrir vínculos</strong>.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 overflow-y-auto p-4">
                    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Itens pendentes</p>
                        <p className="mt-1 text-4xl font-black leading-none tracking-tight text-destructive tabular-nums">
                          {displayedPendingCount}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          item{displayedPendingCount === 1 ? "" : "ns"} pendente{displayedPendingCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle>Filtros</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-3">
                        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos status</SelectItem>
                            <SelectItem value="OPEN">Abertos</SelectItem>
                            <SelectItem value="RESOLVED">Resolvidos</SelectItem>
                            <SelectItem value="IGNORED">Ignorados</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={kind} onValueChange={setKind}>
                          <SelectTrigger className="w-[240px]">
                            <SelectValue placeholder="Tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos tipos</SelectItem>
                            <SelectItem value="missing_conversion">Revisão de linha / conversão</SelectItem>
                            <SelectItem value="missing_product_match">Vínculo NF → catálogo</SelectItem>
                          </SelectContent>
                        </Select>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Lista</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {loadingPending ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Carregando pendências...
                          </div>
                        ) : rows.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhuma pendência para o filtro atual.</p>
                        ) : rows.map((r) => {
                          const isResolved = r.status === "RESOLVED";
                          const isOpen = r.status === "OPEN";
                          const productId = readPayloadProductId(r.payload);
                          const product = productId ? pendingProducts[productId] : undefined;
                          const config = productId ? pendingProductConfigs[productId] : undefined;
                          const resolvedType =
                            (config?.final_operational_type ?? config?.suggested_operational_type ?? "REVISAO_PENDENTE") as OperationalItemType;
                          const importedUnitRaw = readPayloadUnitRaw(r.payload);
                          const selectedUnit = product?.unit?.trim() ?? "";
                          const unitOptions = buildProductUnitSelectOptions(
                            selectedUnit || importedUnitRaw || "un",
                            customUnitAliasOptions,
                          );
                          const reasonCode = readPendingPayloadReasonCode(r.payload);
                          const payloadProductName = String(
                            (r.payload as Record<string, unknown> | null)?.product_name ?? "",
                          ).trim();
                          const candidateIds = readPayloadCandidateProductIds(r.payload);
                          const suggestedCatalog = readSuggestedCatalogName(r.payload);
                          const hasAiSuggestionBlock =
                            isOpen &&
                            r.kind === "missing_product_match" &&
                            Boolean(r.expense_item_id) &&
                            (candidateIds.length > 0 || Boolean(suggestedCatalog));
                          return (
                            <div
                              key={r.id}
                              className={cn(
                                "rounded-lg border p-3 transition-all",
                                isResolved && "border-emerald-500/70 bg-emerald-50/40 py-2 dark:bg-emerald-950/20"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                  {r.kind === "missing_conversion" && reasonCode ? (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 text-[11px] font-semibold uppercase tracking-wide"
                                    >
                                      {importPendingReasonBadgeLabel(reasonCode)}
                                    </Badge>
                                  ) : null}
                                  <p
                                    className={cn(
                                      "min-w-0 text-sm font-medium",
                                      isResolved && "text-emerald-700 dark:text-emerald-300",
                                    )}
                                  >
                                    {r.title}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isResolved ? (
                                    <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-300">
                                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                      Resolvido
                                    </Badge>
                                  ) : null}
                                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span>
                                </div>
                              </div>
                              {r.detail ? (
                                <p className="mt-2 text-sm leading-snug text-muted-foreground">{r.detail}</p>
                              ) : null}
                              {isOpen &&
                              !isResolved &&
                              (r.kind === "missing_conversion" ||
                                (r.kind === "missing_product_match" &&
                                  !(r.expense_item_id && (candidateIds.length > 0 || Boolean(suggestedCatalog))))) ? (
                                <ImportPendingProductMatchDetail
                                  payload={r.payload as Record<string, unknown> | null}
                                  className="mt-2"
                                />
                              ) : null}
                              {!isResolved ? (
                                <>
                                  {isOpen && hasAiSuggestionBlock ? (
                                    <div className="mt-3 space-y-2 rounded-md border border-primary/20 bg-primary/[0.04] p-3 dark:bg-primary/10">
                                      <div className="space-y-1">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                                          Aplicar sugestão da importação
                                        </p>
                                        <p className="text-sm leading-snug text-muted-foreground">
                                          Use um dos botões abaixo para gravar na despesa o vínculo ou o nome sugerido
                                          pelo assistente de importação. Isso atualiza a linha e encerra este alerta.
                                        </p>
                                      </div>
                                      <ImportPendingProductMatchDetail
                                        payload={r.payload as Record<string, unknown> | null}
                                      />
                                      {readPayloadXmlProductName(r.payload) ? (
                                        <p className="text-sm">
                                          <span className="text-muted-foreground">Na NF: </span>
                                          <span className="font-medium">{readPayloadXmlProductName(r.payload)}</span>
                                        </p>
                                      ) : null}
                                      {suggestedCatalog ? (
                                        <p className="text-sm">
                                          <span className="text-muted-foreground">Sugestão de cadastro: </span>
                                          <span className="font-medium">{suggestedCatalog}</span>
                                        </p>
                                      ) : null}
                                      <div className="flex flex-wrap gap-2">
                                        {candidateIds.map((cid) => (
                                          <Button
                                            key={`${r.id}-cand-${cid}`}
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            disabled={busy === r.id}
                                            onClick={() => void applyLinkCandidateAndResolve(r, cid)}
                                          >
                                            Aplicar vínculo: {pendingProducts[cid]?.name ?? `Produto ${cid.slice(0, 8)}…`}
                                          </Button>
                                        ))}
                                        {suggestedCatalog ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            disabled={busy === r.id}
                                            onClick={() => void createSuggestedProductAndResolve(r)}
                                          >
                                            Aplicar sugestão: criar produto
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                  {isOpen && !productId && r.kind === "missing_conversion" ? (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                      {payloadProductName
                                        ? `Linha na NF: ${payloadProductName}. Abra a despesa para vincular o produto e conferir valores.`
                                        : "Abra a despesa para vincular o produto e conferir valores."}
                                    </p>
                                  ) : null}
                                  {isOpen && productId && product ? (
                                    <div className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3">
                                      <div className="grid gap-1.5">
                                        <Label className="text-xs text-muted-foreground">Produto vinculado</Label>
                                        <p className="text-sm font-medium">{product.name}</p>
                                      </div>
                                      <div className="grid gap-1.5">
                                        <Label className="text-xs text-muted-foreground">Unidade de estoque</Label>
                                        <Select
                                          value={selectedUnit || undefined}
                                          onValueChange={(v) => void persistProductUnit(productId, v)}
                                          disabled={busyProductId === productId}
                                        >
                                          <SelectTrigger className="h-9">
                                            <SelectValue placeholder="Selecione a unidade" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {unitOptions.map((option) => (
                                              <SelectItem key={`${r.id}-unit-${option.value}`} value={option.value}>
                                                {option.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <div className="flex gap-2">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openCreateUnitDialog(productId)}
                                            disabled={busyProductId === productId}
                                          >
                                            Cadastrar unidade
                                          </Button>
                                          {importedUnitRaw ? (
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              onClick={() => void persistProductUnit(productId, importedUnitRaw)}
                                              disabled={busyProductId === productId}
                                            >
                                              Usar unidade do XML ({importedUnitRaw})
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="grid gap-1.5">
                                        <Label className="text-xs text-muted-foreground">Tipo final</Label>
                                        <Select
                                          value={resolvedType}
                                          onValueChange={(v) =>
                                            void persistProductType(productId, v as OperationalItemType)
                                          }
                                          disabled={busyProductId === productId}
                                        >
                                          <SelectTrigger className="h-9">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {OPERATIONAL_ITEM_TYPES.map((type) => (
                                              <SelectItem key={`${r.id}-type-${type}`} value={type}>
                                                {TYPE_LABEL[type]}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                              {isOpen ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {r.expense_id ? (
                                    <Button size="sm" variant="secondary" asChild>
                                      <Link
                                        to={`/app/despesas?expense=${encodeURIComponent(r.expense_id)}`}
                                      >
                                        Abrir despesa
                                      </Link>
                                    </Button>
                                  ) : null}
                                  {productId && product ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setCadastroProductId(productId)}
                                    >
                                      Ajustar cadastro
                                    </Button>
                                  ) : null}
                                  <Button size="sm" onClick={() => void closePending(r.id, "RESOLVED")} disabled={busy === r.id}>
                                    {hasAiSuggestionBlock
                                      ? "Encerrar sem aplicar sugestão"
                                      : "Marcar como conferido"}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => void closePending(r.id, "IGNORED")} disabled={busy === r.id}>
                                    Ignorar
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </div>
                </SheetContent>
              </Sheet>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d1"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-800 dark:text-red-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-1 (amanhã)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD1}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d3"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-3 (em 3 dias)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD3}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=recebimento_falta"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-800 dark:text-orange-400">
                    <PackageX className="h-4 w-4" />
                  </span>
                  <span className="truncate">Itens não entregues</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {notReceived}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=expense_no_boleto"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate">Despesas sem boleto</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {withoutBoleto}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/produtos?estoque=baixo"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="truncate">Estoque baixo</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {lowStock}
                </span>
              </Link>
            </li>
          </ul>
        )}
      </CardContent>
      <Dialog
        open={createUnitTargetProductId !== null}
        onOpenChange={(open) => {
          if (!open && !savingNewUnit) setCreateUnitTargetProductId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar unidade de medida</DialogTitle>
            <DialogDescription>
              Crie uma nova unidade e aplique no item selecionado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="pending-new-unit-code">Código</Label>
              <Input
                id="pending-new-unit-code"
                value={newUnitCode}
                onChange={(e) => setNewUnitCode(e.target.value)}
                placeholder="ex.: vidro, fd, cx2"
                autoComplete="off"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pending-new-unit-label">Nome</Label>
              <Input
                id="pending-new-unit-label"
                value={newUnitLabel}
                onChange={(e) => setNewUnitLabel(e.target.value)}
                placeholder="ex.: Vidro, Caixa 12 un"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateUnitTargetProductId(null)}
              disabled={savingNewUnit}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveNewCustomUnit()}
              disabled={savingNewUnit}
            >
              {savingNewUnit ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Salvar unidade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </>
  );
}

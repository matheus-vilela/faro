import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { evaluateConfigurationCompleteness } from "@/lib/itemClassification/evaluateConfigurationCompleteness";
import {
  buildProductUnitSelectOptions,
  isSystemUnitCode,
  isUnitInCompanyCatalog,
  type CompanyUnitAliasRow,
} from "@/lib/companyUnits/productUnitOptions";
import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import { OPERATIONAL_ITEM_TYPES } from "@/lib/itemClassification/operationalItemTypes";
import type { CompanyMasterCatalogOverrideInput } from "@/lib/masterItemCatalog/companyContext";
import { suggestOperationalItemTypeFromName } from "@/lib/itemClassification/suggestOperationalItemType";
import { suggestProductCatalogCategory } from "@/lib/companyProductCategories/suggestProductCatalogCategory";
import { instantiateMasterRecipeFromTemplate } from "@/lib/masterRecipeCatalog/instantiateMasterRecipeForCompany";
import { canonicalProductName } from "@/lib/productImport/canonicalName";
import { PRODUCT_CATALOG_PATH } from "@/lib/productStockPaths";
import { supabase } from "@/lib/supabase";
import type { ItemClassificationOnboardingSnapshot } from "@/types/companySetup";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { Boxes, ListFilter, Loader2, PackageX, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  /** Unidade bruta vinda de XML/nota, quando ainda houver. */
  import_unit_raw: string | null;
  stock_control_type: string | null;
  cmv_category_id: string | null;
  category_count: number;
  categoryIds: string[];
};

type ConfigRow = {
  suggested_operational_type: OperationalItemType;
  suggested_score: number;
  suggestion_reasons: Record<string, unknown> | null;
  final_operational_type: OperationalItemType | null;
  final_decision_source: string | null;
  configuration_status: string;
  linked_entry_breakdown_recipe_id: string | null;
  configuration_completeness: Record<string, unknown> | null;
} | null;

function normalizeCustomUnitCode(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

const TYPE_LABEL: Record<OperationalItemType, string> = {
  INSUMO: "Insumo",
  PRODUTO_REVENDA: "Revenda",
  ITEM_OPERACIONAL: "Operacional",
  RECEITA_FICHA: "Receita / ficha (entrada)",
  NAO_ESTOCAVEL: "Não estocável",
  REVISAO_PENDENTE: "Revisar",
};

function effectiveOperationalType(config: ConfigRow): OperationalItemType {
  if (!config) return "REVISAO_PENDENTE";
  const fromDb = (config.final_operational_type ?? config.suggested_operational_type) as OperationalItemType;
  return OPERATIONAL_ITEM_TYPES.includes(fromDb) ? fromDb : "REVISAO_PENDENTE";
}

function ProductStockUnitField({
  product,
  busyId,
  customUnitAliasOptions,
  onOpenCreateDialog,
  onPersist,
  onUseXmlUnit,
  compact = false,
}: {
  product: ProductRow;
  busyId: string | null;
  customUnitAliasOptions: CompanyUnitAliasRow[];
  onOpenCreateDialog: () => void;
  onPersist: (unit: string) => void;
  onUseXmlUnit: () => void;
  compact?: boolean;
}) {
  const unitRaw = (product.unit ?? "").trim();
  const vLower = unitRaw.toLowerCase();
  const xmlUnit = (product.import_unit_raw ?? "").trim();
  const xmlEqualsStored =
    xmlUnit.length > 0 && xmlUnit.toLowerCase() === vLower;
  const inCatalog = isUnitInCompanyCatalog(product.unit, customUnitAliasOptions);
  const unitOptions = buildProductUnitSelectOptions(product.unit, customUnitAliasOptions);
  const selectedValue = unitOptions.find(
    (o) => o.value === unitRaw || o.value.toLowerCase() === vLower,
  )?.value;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
      <SearchSelect
        id={`unit-${product.id}`}
        value={selectedValue ?? ""}
        onValueChange={(v) => {
          if (v === selectedValue) return;
          onPersist(v);
        }}
        disabled={busyId === product.id}
        options={unitOptions}
        placeholder="Selecione a unidade"
        searchPlaceholder="Buscar unidade…"
        emptyMessage="Nenhuma unidade encontrada."
        triggerClassName="h-9 w-full min-w-0 text-left text-sm"
        listMaxHeightClassName="max-h-[min(60vh,22rem)]"
      />
      {!inCatalog && unitRaw && xmlUnit ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 w-full text-sm"
          disabled={busyId === product.id || xmlEqualsStored}
          onClick={onUseXmlUnit}
        >
          {xmlEqualsStored ? "Já corresponde ao XML" : `Usar unidade do XML (${xmlUnit})`}
        </Button>
      ) : null}
      {!inCatalog && unitRaw ? (
        <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-2.5 dark:border-amber-500/20">
          <p className="text-sm leading-snug text-amber-950 dark:text-amber-100/90">
            Código fora do catálogo. Troque no seletor acima ou registe abaixo.
          </p>
          <div className="mt-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 w-full min-h-9 text-sm"
              disabled={busyId === product.id}
              onClick={onOpenCreateDialog}
            >
              Cadastrar unidade
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function priorityScore(p: {
  name: string;
  cfg: ConfigRow;
  product: ProductRow;
}): number {
  if (!p.cfg) return 0;
  if (isReviewedInStep(p.cfg)) return -1000;
  const s = p.cfg.suggested_score ?? 0;
  if (!p.product.unit?.trim()) return 80 + s;
  if (p.product.categoryIds.length === 0) return 70 + s;
  if (p.cfg.suggested_operational_type === "RECEITA_FICHA") return 60 + s;
  if (p.cfg.configuration_status === "BLOQUEADO") return 25;
  return 50 + s;
}

function isReviewedInStep(config: ConfigRow): boolean {
  if (!config) return false;
  const t = config.final_operational_type;
  if (t !== "INSUMO" && t !== "NAO_ESTOCAVEL") return false;
  return config.final_decision_source === "USER_EDITED" || config.final_decision_source === "USER_CONFIRMED";
}

export function StepItemClassificationForm({
  companyId,
  onOnboardingSnapshot,
}: {
  companyId: string;
  onOnboardingSnapshot: (s: ItemClassificationOnboardingSnapshot) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "incomplete" | "blocked" | "recipe_suggest" | "reviewed">("incomplete");
  const [rows, setRows] = useState<
    Array<{
      product: ProductRow;
      config: ConfigRow;
    }>
  >([]);
  const [recipesByProduct, setRecipesByProduct] = useState<
    Record<string, Array<{ id: string; name: string; version: number }>>
  >({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customUnitAliasOptions, setCustomUnitAliasOptions] = useState<
    CompanyUnitAliasRow[]
  >([]);
  const [createUnitDialog, setCreateUnitDialog] = useState<ProductRow | null>(null);
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitLabel, setNewUnitLabel] = useState("");
  const [savingNewUnit, setSavingNewUnit] = useState(false);
  /** Tally de *outros* itens com o mesmo nome canónico já classificados (reforça sugestão). */
  const [peerTalliesByProduct, setPeerTalliesByProduct] = useState<
    Map<string, Partial<Record<OperationalItemType, number>>>
  >(() => new Map());
  const [companyProductCategories, setCompanyProductCategories] = useState<CompanyProductCategory[]>([]);
  const [masterCatalogOverrides, setMasterCatalogOverrides] = useState<CompanyMasterCatalogOverrideInput[]>([]);
  const [learningTalliesByNormalized, setLearningTalliesByNormalized] = useState<
    Map<string, Partial<Record<OperationalItemType, number>>>
  >(() => new Map());

  const loadCustomUnitAliases = useCallback(async () => {
    if (!companyId) {
      setCustomUnitAliasOptions([]);
      return;
    }
    const { data, error } = await supabase
      .from("company_custom_unit_aliases")
      .select("unit_code, unit_label")
      .eq("company_id", companyId)
      .order("unit_label", { ascending: true });
    if (error) {
      console.error(error);
      setCustomUnitAliasOptions([]);
      return;
    }
    setCustomUnitAliasOptions((data ?? []) as CompanyUnitAliasRow[]);
  }, [companyId]);

  /** Atualiza só o progresso do onboarding (percentual) — leve, sem refetch da listagem. */
  const refreshOnboardingStatus = useCallback(async () => {
    if (!companyId) return;
    const { data: status, error: e1 } = await supabase.rpc("get_item_classification_onboarding_status", {
      p_company_id: companyId,
    });
    if (e1) {
      toast.error(e1.message);
      return;
    }
    const st = status as {
      ok?: boolean;
      total_products?: number;
      incomplete?: number;
      percent?: number;
    };
    if (st?.ok) {
      onOnboardingSnapshot({
        total_products: st.total_products ?? 0,
        incomplete: st.incomplete ?? 0,
        percent: typeof st.percent === "number" ? st.percent : 0,
        synced_at: new Date().toISOString(),
      });
    }
  }, [companyId, onOnboardingSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    await loadCustomUnitAliases();
    await refreshOnboardingStatus();

    const { data: prods, error: e2 } = await supabase
      .from("products")
      .select("id, name, unit, import_unit_raw, stock_control_type, cmv_category_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(500);
    if (e2) {
      toast.error(e2.message);
      setLoading(false);
      return;
    }
    const ids = (prods ?? []).map((p) => p.id);
    if (ids.length === 0) {
      setRows([]);
      setPeerTalliesByProduct(new Map());
      setLoading(false);
      return;
    }
    const { data: pcc, error: pccErr } = await supabase
      .from("company_product_categories")
      .select("id, company_id, name, sort_order, created_at, updated_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (pccErr) {
      console.error(pccErr);
      setCompanyProductCategories([]);
    } else {
      setCompanyProductCategories((pcc ?? []) as CompanyProductCategory[]);
    }

    const { data: ovrRows, error: ovrErr } = await supabase
      .from("company_master_catalog_override")
      .select("id, custom_name, custom_alias, override_operational_type, master_item_id, score_adjustment, active")
      .eq("company_id", companyId)
      .eq("active", true);
    if (ovrErr) {
      console.error(ovrErr);
    }
    const ovr = (ovrErr ? [] : ovrRows) ?? [];
    const mOvr = [...new Set(ovr.map((r) => (r as { master_item_id?: string | null }).master_item_id).filter(Boolean))] as string[];
    const extByM = new Map<string, string | null>();
    if (mOvr.length) {
      const { data: mcat, error: mErr } = await supabase
        .from("master_item_catalog")
        .select("id, external_key")
        .in("id", mOvr);
      if (mErr) console.error(mErr);
      for (const row of mcat ?? []) {
        const x = row as { id: string; external_key: string | null };
        extByM.set(x.id, x.external_key ?? null);
      }
    }
    const overridesList: CompanyMasterCatalogOverrideInput[] = ovr.map((raw) => {
      const r = raw as {
        id: string;
        custom_name: string | null;
        custom_alias: string | null;
        override_operational_type: OperationalItemType | null;
        master_item_id: string | null;
        score_adjustment: number | null;
        active: boolean;
      };
      return {
        id: r.id,
        custom_name: r.custom_name,
        custom_alias: r.custom_alias,
        override_operational_type: r.override_operational_type,
        master_external_key: r.master_item_id ? extByM.get(r.master_item_id) ?? null : null,
        score_adjustment: r.score_adjustment,
        active: r.active,
      };
    });
    setMasterCatalogOverrides(overridesList);

    const { data: lrn, error: lrnErr } = await supabase
      .from("company_item_classification_learning")
      .select("normalized_input, chosen_operational_type")
      .eq("company_id", companyId)
      .limit(5000);
    if (lrnErr) {
      console.error(lrnErr);
    }
    const learningMap = new Map<string, Partial<Record<OperationalItemType, number>>>();
    for (const row of (lrnErr ? [] : lrn) ?? []) {
      const k = (row as { normalized_input: string }).normalized_input?.trim();
      const t = (row as { chosen_operational_type: OperationalItemType }).chosen_operational_type;
      if (!k || !t) continue;
      const cur = learningMap.get(k) ?? {};
      cur[t] = (cur[t] ?? 0) + 1;
      learningMap.set(k, cur);
    }
    setLearningTalliesByNormalized(learningMap);

    const { data: ass } = await supabase
      .from("product_category_assignments")
      .select("product_id, category_id")
      .in("product_id", ids);
    const categoryIdsByProduct: Record<string, string[]> = {};
    for (const a of ass ?? []) {
      const row = a as { product_id: string; category_id: string };
      if (!categoryIdsByProduct[row.product_id]) categoryIdsByProduct[row.product_id] = [];
      categoryIdsByProduct[row.product_id]!.push(row.category_id);
    }
    const { data: confs, error: e3 } = await supabase
      .from("product_operational_config")
      .select(
        "product_id, suggested_operational_type, suggested_score, suggestion_reasons, final_operational_type, final_decision_source, configuration_status, linked_entry_breakdown_recipe_id, configuration_completeness",
      )
      .eq("company_id", companyId);
    if (e3) {
      toast.error(e3.message);
      setLoading(false);
      return;
    }
    const confMap = new Map<string, (typeof confs)[0]>();
    for (const c of confs ?? []) {
      confMap.set(c.product_id as string, c);
    }

    const { data: rcp } = await supabase
      .from("recipes")
      .select("id, name, version, output_product_id")
      .eq("company_id", companyId)
      .eq("recipe_type", "ENTRY_BREAKDOWN")
      .eq("active", true)
      .in("output_product_id", ids)
      .order("name", { ascending: true });
    const byPid: Record<string, Array<{ id: string; name: string; version: number }>> = {};
    for (const r of rcp ?? []) {
      const row = r as {
        id: string;
        name: string;
        version: number;
        output_product_id: string | null;
      };
      if (!row.output_product_id) continue;
      if (!byPid[row.output_product_id]) byPid[row.output_product_id] = [];
      byPid[row.output_product_id].push({
        id: row.id,
        name: row.name,
        version: row.version,
      });
    }
    setRecipesByProduct(byPid);

    const byNameKey = new Map<string, Array<{ id: string; type: OperationalItemType }>>();
    for (const p of prods ?? []) {
      const co = confMap.get(p.id);
      if (!co) continue;
      const t = (co.final_operational_type ?? co.suggested_operational_type) as
        | OperationalItemType
        | null;
      if (!t) continue;
      const k = canonicalProductName(p.name) || p.name.trim().toLowerCase();
      if (!k) continue;
      if (!byNameKey.has(k)) byNameKey.set(k, []);
      byNameKey.get(k)!.push({ id: p.id, type: t });
    }
    const peerByPid = new Map<string, Partial<Record<OperationalItemType, number>>>();
    for (const p of prods ?? []) {
      const k = canonicalProductName(p.name) || p.name.trim().toLowerCase();
      const ar = byNameKey.get(k) ?? [];
      const tally: Partial<Record<OperationalItemType, number>> = {};
      for (const e of ar) {
        if (e.id === p.id) continue;
        tally[e.type] = (tally[e.type] ?? 0) + 1;
      }
      peerByPid.set(p.id, tally);
    }
    setPeerTalliesByProduct(new Map(peerByPid));

    const merged: Array<{ product: ProductRow; config: ConfigRow }> = (prods ?? []).map(
      (p) => {
        const co = confMap.get(p.id);
        let config: ConfigRow = co
          ? {
              suggested_operational_type: co.suggested_operational_type as OperationalItemType,
              suggested_score: Number(co.suggested_score),
              suggestion_reasons: (co.suggestion_reasons ?? null) as Record<
                string,
                unknown
              > | null,
              final_operational_type: co.final_operational_type as OperationalItemType | null,
              final_decision_source: co.final_decision_source,
              configuration_status: co.configuration_status,
              linked_entry_breakdown_recipe_id: co.linked_entry_breakdown_recipe_id,
              configuration_completeness: (co.configuration_completeness ?? null) as Record<
                string,
                unknown
              > | null,
            }
          : null;
        if (!config) {
          const peerTally = peerByPid.get(p.id) ?? {};
          const nameKey = canonicalProductName(p.name) || p.name.trim().toLowerCase();
          const s = suggestOperationalItemTypeFromName({
            name: p.name,
            stockControlType: p.stock_control_type,
            peerNameTypeTallies: peerTally,
            classificationLearningTallies: learningMap.get(nameKey),
            companyMasterCatalogOverrides: overridesList,
          });
          config = {
            suggested_operational_type: s.suggested_type,
            suggested_score: s.suggested_score,
            suggestion_reasons: s.suggestion_reasons as Record<string, unknown>,
            final_operational_type: null,
            final_decision_source: null,
            configuration_status: "PENDENTE",
            linked_entry_breakdown_recipe_id: null,
            configuration_completeness: null,
          };
        }
        const cids = categoryIdsByProduct[p.id] ?? [];
        return {
          product: {
            id: p.id,
            name: p.name,
            unit: p.unit,
            import_unit_raw: p.import_unit_raw ?? null,
            stock_control_type: p.stock_control_type,
            cmv_category_id: p.cmv_category_id,
            category_count: cids.length,
            categoryIds: cids,
          },
          config,
        };
      },
    );
    setRows(merged);
    setLoading(false);
  }, [companyId, loadCustomUnitAliases, refreshOnboardingStatus]);

  useEffect(() => {
    // Carregamento ao montar (padrão data fetch).
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- carga assíncrona única
  }, [load]);

  const saveRow = useCallback(
    async (product: ProductRow, draft: { finalType: OperationalItemType; recipeId: string | null }) => {
      setBusyId(product.id);
      const nKey = canonicalProductName(product.name) || product.name.trim().toLowerCase();
      const s = suggestOperationalItemTypeFromName({
        name: product.name,
        stockControlType: product.stock_control_type,
        peerNameTypeTallies: peerTalliesByProduct.get(product.id) ?? {},
        classificationLearningTallies: learningTalliesByNormalized.get(nKey),
        companyMasterCatalogOverrides: masterCatalogOverrides,
      });
      const evald = evaluateConfigurationCompleteness({
        finalType: draft.finalType,
        product: {
          unit: product.unit,
          cmv_category_id: product.cmv_category_id,
          has_product_category_assignment: product.categoryIds.length > 0,
        },
        linkedEntryBreakdownRecipeId: draft.recipeId,
      });
      const { data, error } = await supabase.rpc("upsert_product_operational_config", {
        p_product_id: product.id,
        p_suggested_operational_type: s.suggested_type,
        p_suggested_score: s.suggested_score,
        p_suggestion_reasons: s.suggestion_reasons,
        p_final_operational_type: draft.finalType,
        p_final_decision_source: "USER_EDITED",
        p_configuration_status: evald.configuration_status,
        p_configuration_completeness: { ...evald.flags, auto: "wizard" } as never,
        p_linked_entry_breakdown_recipe_id: draft.recipeId,
        p_notes: null,
        p_ui_filter_json: { filter, search: search || null } as never,
      });
      setBusyId(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      const o = data as { ok?: boolean; error?: string };
      if (!o?.ok) {
        toast.error(o?.error ?? "Falha ao salvar");
        return;
      }
      const learnErr = await supabase.from("company_item_classification_learning").insert({
        company_id: companyId,
        normalized_input: nKey,
        chosen_operational_type: draft.finalType,
        source: "ONBOARDING_CONFIRMATION",
        confidence: 1,
      });
      if (learnErr.error) {
        console.error(learnErr.error);
      } else {
        setLearningTalliesByNormalized((prev) => {
          const m = new Map(prev);
          const cur = { ...(m.get(nKey) ?? {}) };
          cur[draft.finalType] = (cur[draft.finalType] ?? 0) + 1;
          m.set(nKey, cur);
          return m;
        });
      }
      setRows((prev) =>
        prev.map((row) => {
          if (row.product.id !== product.id || !row.config) return row;
          return {
            product: row.product,
            config: {
              ...row.config,
              suggested_operational_type: s.suggested_type,
              suggested_score: s.suggested_score,
              suggestion_reasons: s.suggestion_reasons as Record<string, unknown> | null,
              final_operational_type: draft.finalType,
              final_decision_source: "USER_EDITED",
              configuration_status: evald.configuration_status,
              configuration_completeness: { ...evald.flags, auto: "wizard" } as Record<string, unknown>,
              linked_entry_breakdown_recipe_id: draft.recipeId,
            },
          };
        }),
      );
      void refreshOnboardingStatus();
    },
    [
      companyId,
      filter,
      search,
      peerTalliesByProduct,
      learningTalliesByNormalized,
      masterCatalogOverrides,
      refreshOnboardingStatus,
    ],
  );

  const companyProductLookupList = useMemo(
    () => rows.map((r) => ({ id: r.product.id, name: r.product.name })),
    [rows],
  );

  const createRecipeFromMasterTemplate = useCallback(
    async (product: ProductRow, config: NonNullable<ConfigRow>) => {
      const mrId = (
        config.suggestion_reasons as { master_recipe?: { master_recipe_id?: string } } | null
      )?.master_recipe?.master_recipe_id;
      if (!mrId?.trim()) {
        toast.error("Nenhum template mestre sugerido para este item.");
        return;
      }
      setBusyId(product.id);
      const res = await instantiateMasterRecipeFromTemplate(supabase, {
        companyId,
        outputProductId: product.id,
        masterRecipeExternalKey: mrId,
        companyProducts: companyProductLookupList,
        supersedeRecipeId: config.linked_entry_breakdown_recipe_id,
      });
      setBusyId(null);
      if (!res.ok) {
        if (res.error === "unresolved_master_items" && res.unresolvedMasterItems?.length) {
          toast.error(
            `Inclua produtos no catálogo compatíveis com os insumos: ${res.unresolvedMasterItems.join(", ")}.`,
          );
        } else {
          toast.error(
            res.error === "template_not_found"
              ? "Template não encontrado."
              : res.error === "no_ingredients"
                ? "Composição vazia."
                : res.error,
          );
        }
        return;
      }
      toast.success(`Ficha criada (versão ${res.version}).`);
      await saveRow(product, {
        finalType: "RECEITA_FICHA",
        recipeId: res.recipeId,
      });
      void load();
    },
    [companyId, companyProductLookupList, load, saveRow],
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      r = r.filter((x) => x.product.name.toLowerCase().includes(t));
    }
    if (filter === "incomplete") {
      r = r.filter((x) => (x.config?.configuration_status ?? "") !== "CONFIGURADO");
    } else if (filter === "blocked") {
      r = r.filter((x) => x.config?.configuration_status === "BLOQUEADO");
    } else if (filter === "recipe_suggest") {
      r = r.filter((x) => {
        const fromDb =
          (x.config?.final_operational_type ?? x.config?.suggested_operational_type) as
            | OperationalItemType
            | undefined;
        return fromDb === "RECEITA_FICHA";
      });
    } else if (filter === "reviewed") {
      r = r.filter((x) => isReviewedInStep(x.config));
    }
    return [...r].sort(
      (a, b) => priorityScore({ name: b.product.name, cfg: b.config, product: b.product }) -
        priorityScore({ name: a.product.name, cfg: a.config, product: a.product }),
    );
  }, [rows, search, filter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const bulkApply = async (t: OperationalItemType) => {
    if (selected.size === 0) {
      toast.message("Selecione itens na lista.");
      return;
    }
    setBusyId("bulk");
    const { data, error } = await supabase.rpc("bulk_set_product_operational_type", {
      p_company_id: companyId,
      p_product_ids: [...selected],
      p_final_operational_type: t,
      p_final_decision_source: "USER_CONFIRMED",
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const o = data as { ok?: boolean; error?: string };
    if (!o?.ok) {
      toast.error(o?.error ?? "Falha em lote");
      return;
    }
    toast.success("Tipo aplicado em lote. Revise unidade e, se precisar, categorias no catálogo de produtos.");
    const ids = [...selected];
    setSelected(new Set());
    setRows((prev) =>
      prev.map((row) => {
        if (!ids.includes(row.product.id) || !row.config) return row;
        const recipeId = t === "RECEITA_FICHA" ? row.config.linked_entry_breakdown_recipe_id : null;
        const evald = evaluateConfigurationCompleteness({
          finalType: t,
          product: {
            unit: row.product.unit,
            cmv_category_id: row.product.cmv_category_id,
            has_product_category_assignment: row.product.categoryIds.length > 0,
          },
          linkedEntryBreakdownRecipeId: recipeId,
        });
        return {
          product: row.product,
          config: {
            ...row.config,
            final_operational_type: t,
            final_decision_source: "USER_CONFIRMED",
            configuration_status: evald.configuration_status,
            configuration_completeness: row.config.configuration_completeness,
            linked_entry_breakdown_recipe_id: recipeId,
          },
        };
      }),
    );
    void refreshOnboardingStatus();
  };

  const persistProductUnit = useCallback(
    async (productId: string, unit: string) => {
      const v = unit.trim().toLowerCase();
      setBusyId(productId);
      const { error } = await supabase
        .from("products")
        .update({ unit: v, updated_at: new Date().toISOString() })
        .eq("id", productId);
      setBusyId(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      setRows((prev) =>
        prev.map((row) => {
          if (row.product.id !== productId || !row.config) return row;
          const nextProduct: ProductRow = { ...row.product, unit: v };
          const eff = effectiveOperationalType(row.config);
          const evald = evaluateConfigurationCompleteness({
            finalType: eff,
            product: {
              unit: nextProduct.unit,
              cmv_category_id: nextProduct.cmv_category_id,
              has_product_category_assignment: nextProduct.categoryIds.length > 0,
            },
            linkedEntryBreakdownRecipeId: row.config.linked_entry_breakdown_recipe_id,
          });
          return {
            product: nextProduct,
            config: {
              ...row.config,
              configuration_status: evald.configuration_status,
              configuration_completeness: {
                ...row.config.configuration_completeness,
                ...evald.flags,
              },
            },
          };
        }),
      );
      void refreshOnboardingStatus();
    },
    [refreshOnboardingStatus],
  );

  const applyUnitFromImportXml = useCallback(
    async (product: ProductRow) => {
      const raw = (product.import_unit_raw ?? "").trim();
      if (!raw) {
        toast.message("Não há unidade do XML para este item.");
        return;
      }
      setBusyId(product.id);
      const { error } = await supabase
        .from("products")
        .update({
          unit: raw.toLowerCase(),
          import_unit_needs_review: false,
          import_unit_raw: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);
      setBusyId(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Unidade do XML aplicada.");
      const v = raw.toLowerCase();
      setRows((prev) =>
        prev.map((row) => {
          if (row.product.id !== product.id || !row.config) return row;
          const nextProduct: ProductRow = {
            ...row.product,
            unit: v,
            import_unit_raw: null,
          };
          const eff = effectiveOperationalType(row.config);
          const evald = evaluateConfigurationCompleteness({
            finalType: eff,
            product: {
              unit: nextProduct.unit,
              cmv_category_id: nextProduct.cmv_category_id,
              has_product_category_assignment: nextProduct.categoryIds.length > 0,
            },
            linkedEntryBreakdownRecipeId: row.config.linked_entry_breakdown_recipe_id,
          });
          return {
            product: nextProduct,
            config: {
              ...row.config,
              configuration_status: evald.configuration_status,
              configuration_completeness: {
                ...row.config.configuration_completeness,
                ...evald.flags,
              },
            },
          };
        }),
      );
      void refreshOnboardingStatus();
    },
    [refreshOnboardingStatus],
  );

  const openCreateUnitDialog = useCallback((product: ProductRow) => {
    const raw = (product.unit ?? "").trim();
    setNewUnitCode(raw ? normalizeCustomUnitCode(raw) || raw.toLowerCase() : "");
    setNewUnitLabel("");
    setCreateUnitDialog(product);
  }, []);

  const handleSaveNewCustomUnit = useCallback(async () => {
    if (!createUnitDialog) return;
    const code = normalizeCustomUnitCode(newUnitCode);
    const label = newUnitLabel.trim();
    if (!code) {
      toast.error("Informe um código de unidade (ex.: vidro, fd, cx2).");
      return;
    }
    if (!label) {
      toast.error("Informe o nome a mostrar (ex.: Vidro, Caixa 12 un).");
      return;
    }
    if (isSystemUnitCode(code)) {
      setCreateUnitDialog(null);
      setSavingNewUnit(false);
      void persistProductUnit(createUnitDialog.id, code);
      return;
    }
    setSavingNewUnit(true);
    const sourceHint = (createUnitDialog.unit ?? "").trim() || code;
    const { data, error } = await supabase.rpc("register_company_custom_unit_alias", {
      p_company_id: companyId,
      p_unit_label: label,
      p_unit_code: code,
      p_source_hint: sourceHint,
      p_apply_to_existing: true,
    });
    if (error) {
      const msg = String(error.message ?? "");
      const canFallback =
        msg.includes("register_company_custom_unit_alias") && msg.includes("does not exist");
      if (!canFallback) {
        toast.error(`Falha ao criar unidade: ${error.message}`);
        setSavingNewUnit(false);
        return;
      }
      const { error: upsertError } = await supabase
        .from("company_custom_unit_aliases")
        .upsert(
          {
            company_id: companyId,
            unit_code: code,
            unit_label: label,
            source_hint: sourceHint,
          },
          { onConflict: "company_id,unit_code" },
        );
      if (upsertError) {
        toast.error(`Falha ao registrar unidade: ${upsertError.message}`);
        setSavingNewUnit(false);
        return;
      }
    } else {
      const payload = data as { ok?: boolean; error?: string };
      if (!payload?.ok) {
        toast.error(payload?.error ?? "Não foi possível registrar a unidade.");
        setSavingNewUnit(false);
        return;
      }
    }
    const targetId = createUnitDialog.id;
    const { error: pErr } = await supabase
      .from("products")
      .update({
        unit: code,
        import_unit_needs_review: false,
        import_unit_raw: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetId);
    setSavingNewUnit(false);
    if (pErr) {
      toast.error(`Unidade registrada, mas não aplicou a este item: ${pErr.message}`);
    } else {
      toast.success(`Unidade “${label}” (${code}) registrada e aplicada neste item.`);
    }
    setCreateUnitDialog(null);
    if (!pErr) {
      await loadCustomUnitAliases();
      setRows((prev) =>
        prev.map((row) => {
          if (row.product.id !== targetId || !row.config) return row;
          const nextProduct: ProductRow = { ...row.product, unit: code, import_unit_raw: null };
          const eff = effectiveOperationalType(row.config);
          const evald = evaluateConfigurationCompleteness({
            finalType: eff,
            product: {
              unit: nextProduct.unit,
              cmv_category_id: nextProduct.cmv_category_id,
              has_product_category_assignment: nextProduct.categoryIds.length > 0,
            },
            linkedEntryBreakdownRecipeId: row.config.linked_entry_breakdown_recipe_id,
          });
          return {
            product: nextProduct,
            config: {
              ...row.config,
              configuration_status: evald.configuration_status,
              configuration_completeness: {
                ...row.config.configuration_completeness,
                ...evald.flags,
              },
            },
          };
        }),
      );
      void refreshOnboardingStatus();
    }
  }, [createUnitDialog, companyId, newUnitCode, newUnitLabel, loadCustomUnitAliases, persistProductUnit, refreshOnboardingStatus]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando itens…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Nenhum produto ativo nesta unidade. Você pode avançar — não há itens a classificar.</p>
        <p className="text-xs">
          Importe XMLs na página Importações ou cadastre produtos no catálogo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Classificação de itens</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Revise a sugestão (score) e confirme o tipo. Insumos e itens de operação param de ser
          tratados como receita por engano. O sistema separa <strong>sugestão</strong> e{" "}
          <strong>decisão final</strong> para auditoria.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1 space-y-1">
          <Label htmlFor="ic-search">Busca</Label>
          <Input
            id="ic-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome do item"
          />
        </div>
        <div className="min-w-[200px] space-y-1">
          <Label>Filtro</Label>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger>
              <ListFilter className="mr-1 h-4 w-4 opacity-50" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} className="z-[220]">
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="incomplete">Não concluídos</SelectItem>
              <SelectItem value="blocked">Bloqueados (dependência)</SelectItem>
              <SelectItem value="recipe_suggest">Sugestão receita/ficha</SelectItem>
              <SelectItem value="reviewed">Revisados neste passo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={() => void load()}>
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </div>

      {selected.size > 0 ? (
        <div
          className="rounded-xl border-2 border-primary/30 bg-primary/[0.07] p-3 shadow-sm dark:border-primary/25 dark:bg-primary/10"
          role="region"
          aria-label="Ações em lote para itens selecionados"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
                aria-hidden
              >
                <ListFilter className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold leading-tight text-foreground">
                  {selected.size} item(ns) selecionado(s)
                </p>
                <p className="text-xs text-muted-foreground">
                  Aplique o mesmo tipo operacional a todos de uma vez. Use os botões abaixo.
                </p>
              </div>
            </div>
            <div className="grid w-full gap-1.5 sm:w-auto sm:min-w-[min(100%,20rem)] sm:grid-cols-2 sm:gap-2">
              <Button
                type="button"
                className="h-auto min-h-9 justify-start gap-2 rounded-md px-3 py-1.5 text-left shadow-sm"
                onClick={() => void bulkApply("INSUMO")}
                disabled={busyId !== null}
              >
                <Boxes className="h-3.5 w-3.5 shrink-0 self-center opacity-90" />
                <span className="flex min-w-0 flex-col items-start gap-0 leading-tight">
                  <span className="text-sm font-semibold leading-none">Aplicar como insumo</span>
                  <span className="pt-0.5 text-[0.7rem] font-normal leading-tight text-primary-foreground/80">
                    Cozinha, matéria-prima, preparo
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-9 justify-start gap-2 rounded-md border-2 border-border/80 bg-background px-3 py-1.5 text-left shadow-sm hover:bg-muted/60"
                onClick={() => void bulkApply("NAO_ESTOCAVEL")}
                disabled={busyId !== null}
              >
                <PackageX className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
                <span className="flex min-w-0 flex-col items-start gap-0 leading-tight">
                  <span className="text-sm font-semibold leading-none text-foreground">Não estocável</span>
                  <span className="pt-0.5 text-[0.7rem] font-normal leading-tight text-muted-foreground">
                    Serviços, fora do estoque
                  </span>
                </span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="max-h-[min(70vh,720px)] overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-md border">
        <ul className="m-0 list-none p-0">
          {filtered.map(({ product, config }) => {
            if (!config) return null;
            const fromDb =
              (config.final_operational_type ?? config.suggested_operational_type) as OperationalItemType;
            const finalT = OPERATIONAL_ITEM_TYPES.includes(fromDb) ? fromDb : "REVISAO_PENDENTE";
            const masterReason = (
              config.suggestion_reasons as { master_catalog?: { reason_pt?: string } } | null | undefined
            )?.master_catalog?.reason_pt;
            const masterRecipeReason = (
              config.suggestion_reasons as { master_recipe?: { explanation_pt?: string } } | null | undefined
            )?.master_recipe?.explanation_pt;
            const suggestedMasterRecipeId = (
              config.suggestion_reasons as { master_recipe?: { master_recipe_id?: string } } | null | undefined
            )?.master_recipe?.master_recipe_id;
            const categorySuggest =
              companyProductCategories.length > 0
                ? suggestProductCatalogCategory({
                    categories: companyProductCategories,
                    operationalType: fromDb,
                    productName: product.name,
                  })
                : null;
            const statusClass =
              config.configuration_status === "CONFIGURADO"
                ? "text-emerald-700 dark:text-emerald-400"
                : config.configuration_status === "BLOQUEADO"
                  ? "text-amber-700 dark:text-amber-500"
                  : "text-muted-foreground";
            const recipOpts = recipesByProduct[product.id] ?? [];
            const reviewedInStep = isReviewedInStep(config);
            return (
              <li key={product.id} className="border-b border-border/50 p-4 last:border-b-0 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Checkbox
                      className="mt-1"
                      checked={selected.has(product.id)}
                      onCheckedChange={() => {
                        if (busyId) return;
                        toggleSelect(product.id);
                      }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Estoque (catálogo): {product.stock_control_type ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {reviewedInStep ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        Revisado neste passo
                      </span>
                    ) : null}
                    <span className={`text-xs font-medium ${statusClass}`}>
                      {config.configuration_status}
                    </span>
                  </div>
                </div>
                <div className="mt-3 max-w-xl space-y-2.5">
                  <p className="text-xs text-muted-foreground">
                    Sugestão do sistema:{" "}
                    <span className="font-medium text-foreground">
                      {TYPE_LABEL[config.suggested_operational_type]}
                    </span>{" "}
                    <span className="tabular-nums">({(config.suggested_score * 100).toFixed(0)}%)</span>
                  </p>
                  {masterReason ? (
                    <p className="text-xs text-muted-foreground line-clamp-2" title={masterReason}>
                      {masterReason}
                    </p>
                  ) : null}
                  {masterRecipeReason ? (
                    <p className="text-xs text-muted-foreground line-clamp-2" title={masterRecipeReason}>
                      {masterRecipeReason}
                    </p>
                  ) : null}
                  <div className="space-y-1">
                    <Label htmlFor={`type-${product.id}`} className="text-xs text-muted-foreground">
                      Tipo final
                    </Label>
                    <Select
                      value={finalT}
                      onValueChange={(v) => {
                        const nt = v as OperationalItemType;
                        void saveRow(product, {
                          finalType: nt,
                          recipeId:
                            nt === "RECEITA_FICHA"
                              ? (config.linked_entry_breakdown_recipe_id ?? null)
                              : null,
                        });
                      }}
                      disabled={busyId === product.id}
                    >
                      <SelectTrigger
                        id={`type-${product.id}`}
                        className="h-9 w-full min-w-0 text-left text-sm"
                        size="default"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        className="z-[200] max-w-[min(100vw-2rem,28rem)]"
                        sideOffset={4}
                      >
                        {OPERATIONAL_ITEM_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {finalT === "RECEITA_FICHA" ? (
                      <div className="space-y-1 pt-0.5">
                        <Label className="text-xs text-muted-foreground">Ficha de entrada (desmonte)</Label>
                        {suggestedMasterRecipeId ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mb-1 h-auto min-h-8 w-full justify-start gap-2 whitespace-normal py-1.5 text-left text-xs leading-snug"
                            disabled={busyId === product.id}
                            onClick={() => void createRecipeFromMasterTemplate(product, config)}
                          >
                            {busyId === product.id ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            ) : null}
                            {config.linked_entry_breakdown_recipe_id
                              ? "Nova versão a partir do template sugerido (catálogo mestre)"
                              : "Criar ficha da unidade a partir do template sugerido"}
                          </Button>
                        ) : null}
                        {recipOpts.length === 0 ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400 break-words">
                            Cadastre uma ficha de tipo entrada/desmonte com este produto como saída.
                          </p>
                        ) : (
                          <SearchSelect
                            value={
                              config.linked_entry_breakdown_recipe_id ?? ""
                            }
                            onValueChange={(rid) => {
                              void saveRow(product, {
                                finalType: "RECEITA_FICHA",
                                recipeId: rid,
                              });
                            }}
                            disabled={busyId === product.id}
                            options={recipOpts.map((r) => ({
                              value: r.id,
                              label: `${r.name} (v${r.version})`,
                            }))}
                            placeholder="Escolher ficha"
                            searchPlaceholder="Buscar ficha…"
                            emptyMessage="Nenhuma ficha encontrada."
                            triggerClassName="h-9 w-full min-w-0 text-left text-sm"
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground" htmlFor={`unit-${product.id}`}>
                      Unidade de estoque
                    </Label>
                    <ProductStockUnitField
                      compact
                      product={product}
                      busyId={busyId}
                      customUnitAliasOptions={customUnitAliasOptions}
                      onOpenCreateDialog={() => openCreateUnitDialog(product)}
                      onPersist={(u) => void persistProductUnit(product.id, u)}
                      onUseXmlUnit={() => void applyUnitFromImportXml(product)}
                    />
                  </div>
                  <div className="border-t border-border/50 pt-2.5">
                    <p className="text-xs text-muted-foreground">Categoria (catálogo de produto)</p>
                    <p className="text-sm text-foreground">
                      {categorySuggest ? (
                        <span className="font-medium">{categorySuggest.category.name}</span>
                      ) : companyProductCategories.length === 0 ? (
                        <span className="font-normal text-amber-800 dark:text-amber-400">
                          Crie pastas de categoria em Configurações.
                        </span>
                      ) : (
                        "—"
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Para vincular ou trocar pastas, abra o{" "}
                      <Link to={PRODUCT_CATALOG_PATH} className="text-primary underline-offset-2 hover:underline">
                        catálogo de produtos
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog
        open={createUnitDialog !== null}
        onOpenChange={(o) => {
          if (!o) setCreateUnitDialog(null);
        }}
      >
        <DialogContent
          className="z-[300] sm:max-w-md"
          overlayClassName="z-[299]"
        >
          <DialogHeader>
            <DialogTitle>Registrar unidade no catálogo</DialogTitle>
            <DialogDescription>
              Código curto (como no cadastro de estoque) e nome legível. Fica disponível
              no catálogo e pode alinhar outros itens importados com a mesma abreviação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="new-unit-code">Código</Label>
              <Input
                id="new-unit-code"
                value={newUnitCode}
                onChange={(e) => setNewUnitCode(e.target.value)}
                placeholder="ex.: vidro, fd, cx2"
                autoComplete="off"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-unit-label">Nome</Label>
              <Input
                id="new-unit-label"
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
              onClick={() => setCreateUnitDialog(null)}
              disabled={savingNewUnit}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveNewCustomUnit()}
              disabled={savingNewUnit}
            >
              {savingNewUnit ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

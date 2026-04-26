import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canonicalProductName } from "@/lib/productImport/canonicalName";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { ChevronDown, ChevronUp, FlaskConical } from "lucide-react";
import { useCallback, useState } from "react";

export type RecebimentoItemResolutionFields = {
  id: string;
  product_name: string;
  quantity: number;
  product_id?: string | null;
  import_nature?: string | null;
  import_engine_suggestion?: string | null;
  import_confidence_0_1?: number | null;
  import_score_reasons_json?: Record<string, unknown> | null;
  import_stock_resolution?: string | null;
  resolved_entry_breakdown_recipe_id?: string | null;
  import_pending_resolution?: boolean | null;
};

type Props = {
  token: string;
  item: RecebimentoItemResolutionFields;
  companyId: string | null;
  supplierId: string | null;
  disabled: boolean;
  pendingItemsCount?: number;
  sessionSuggestedRecipeId?: string | null;
  sessionSuggestionActive?: boolean;
  onSessionRecipeSelected?: (recipeId: string) => void;
  onApplyRecipeToAllPending?: (recipeId: string) => Promise<void> | void;
  onSaved: () => void;
};

type EntryBreakdownRecipeOption = {
  id: string;
  name: string;
  version: number;
  output_product_id: string | null;
  batch_yield: number;
  is_recommended?: boolean;
  recommendation_reason?: string | null;
};

type ImportRecipeDraftComponent = {
  id: string;
  product_id: string | null;
  product_name?: string | null;
  raw_component_name: string;
  suggested_quantity: number;
  suggested_unit?: string | null;
  loss_factor: number;
  confidence_0_1?: number | null;
  match_reason?: string | null;
};

type ImportRecipeDraft = {
  id: string;
  status: string;
  confidence_0_1?: number | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  components: ImportRecipeDraftComponent[];
};

type ProductOption = {
  id: string;
  name: string;
  unit: string;
};

export function RecebimentoImportItemResolution({
  token,
  item,
  companyId,
  supplierId,
  disabled,
  pendingItemsCount = 0,
  sessionSuggestedRecipeId,
  sessionSuggestionActive,
  onSessionRecipeSelected,
  onApplyRecipeToAllPending,
  onSaved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<unknown>(null);
  const [memorize, setMemorize] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recipeOptions, setRecipeOptions] = useState<EntryBreakdownRecipeOption[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(
    sessionSuggestedRecipeId ?? item.resolved_entry_breakdown_recipe_id ?? "",
  );
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draft, setDraft] = useState<ImportRecipeDraft | null>(null);
  const [draftRecipeName, setDraftRecipeName] = useState(
    `Entrada - ${item.product_name}`.slice(0, 120),
  );
  const [draftBatchYield, setDraftBatchYield] = useState("1");
  const [draftComponents, setDraftComponents] = useState<ImportRecipeDraftComponent[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [draftFeedbackMsg, setDraftFeedbackMsg] = useState<string | null>(null);

  const pending = item.import_pending_resolution === true;

  const confPct =
    item.import_confidence_0_1 != null
      ? Math.round(Number(item.import_confidence_0_1) * 1000) / 10
      : null;

  const saveResolution = useCallback(
    async (params: {
      import_stock_resolution: "DIRECT" | "EXPLODE_BY_RECIPE";
      resolved_recipe_id: string | null;
      import_nature: string;
      suggestion: string;
    }) => {
      setBusy(true);
      setErr(null);
      const { data, error } = await supabase.rpc(
        "update_expense_item_import_resolution_for_recebimento",
        {
          p_token: token,
          p_expense_item_id: item.id,
          p_import_stock_resolution: params.import_stock_resolution,
          p_resolved_recipe_id: params.resolved_recipe_id,
          p_target_product_id: item.product_id ?? null,
          p_import_nature: params.import_nature,
          p_import_engine_suggestion: params.suggestion,
          p_import_pending_resolution: false,
          p_import_score_reasons_json: item.import_score_reasons_json ?? null,
          p_import_confidence_0_1: item.import_confidence_0_1 ?? null,
        },
      );
      setBusy(false);
      if (error) {
        setErr(error.message);
        return;
      }
      const o = data as { ok?: boolean; error?: string };
      if (!o?.ok) {
        setErr(o?.error ?? "Não foi possível salvar.");
        return;
      }

      if (memorize && companyId) {
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session?.user?.id) {
          const norm = canonicalProductName(item.product_name);
          const mode =
            params.import_stock_resolution === "EXPLODE_BY_RECIPE"
              ? "EXPLODE_BY_RECIPE"
              : "DIRECT_STOCK_ENTRY";
          await supabase.rpc("upsert_import_item_resolution_rule", {
            p_company_id: companyId,
            p_supplier_id: supplierId,
            p_normalized_description: norm,
            p_resolution_mode: mode,
            p_target_product_id: item.product_id ?? null,
            p_target_recipe_id: params.resolved_recipe_id,
            p_auto_apply: true,
            p_ean: null,
            p_ncm: null,
          });
        }
      }
      onSaved();
    },
    [
      token,
      item,
      companyId,
      supplierId,
      memorize,
      onSaved,
    ],
  );

  const loadPreview = useCallback(async () => {
    const rid = selectedRecipeId || item.resolved_entry_breakdown_recipe_id;
    if (!rid) {
      setErr("Nenhuma ficha de entrada sugerida para este item.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "preview_import_recipe_breakdown_for_recebimento",
      {
        p_token: token,
        p_expense_item_id: item.id,
        p_recipe_id: rid,
      },
    );
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setPreview(data);
    setOpen(true);
  }, [selectedRecipeId, token, item.id, item.resolved_entry_breakdown_recipe_id]);

  const loadRecipeOptions = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "list_entry_breakdown_recipes_for_recebimento_item",
      {
        p_token: token,
        p_expense_item_id: item.id,
      },
    );
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      recipes?: EntryBreakdownRecipeOption[];
    };
    if (!payload.ok) {
      setErr(payload.error ?? "Não foi possível listar fichas de entrada.");
      return;
    }
    const opts = Array.isArray(payload.recipes) ? payload.recipes : [];
    setRecipeOptions(opts);
      const hasCurrent = opts.some((r) => r.id === selectedRecipeId);
    if (!hasCurrent) {
      const recommended = opts.find((r) => r.is_recommended);
      setSelectedRecipeId(
          sessionSuggestedRecipeId ??
        recommended?.id ??
          item.resolved_entry_breakdown_recipe_id ??
          opts[0]?.id ??
          "",
      );
    }
  }, [
    item.id,
    item.resolved_entry_breakdown_recipe_id,
    selectedRecipeId,
    sessionSuggestedRecipeId,
    token,
  ]);

  const loadDraft = useCallback(async () => {
    setDraftBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "get_import_recipe_draft_for_recebimento",
      {
        p_token: token,
        p_expense_item_id: item.id,
      },
    );
    setDraftBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      draft?: ImportRecipeDraft | null;
    };
    if (!payload.ok) {
      setErr(payload.error ?? "Não foi possível carregar rascunho.");
      return;
    }
    setDraft(payload.draft ?? null);
    setDraftComponents(
      Array.isArray(payload.draft?.components) ? payload.draft?.components : [],
    );
    setDraftOpen(true);
  }, [token, item.id]);

  const loadProductOptions = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("products")
      .select("id, name, unit")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(2000);
    if (error) return;
    setProductOptions(
      ((data ?? []) as Array<{ id: string; name: string; unit?: string | null }>).map((p) => ({
        id: p.id,
        name: p.name,
        unit: String(p.unit ?? "un"),
      })),
    );
  }, [companyId]);

  const generateDraft = useCallback(async () => {
    setDraftBusy(true);
    setErr(null);
    const base = supabaseUrl.replace(/\/$/, "");
    const { data: sess } = await supabase.auth.getSession();
    const authToken = sess.session?.access_token ?? "";
    const res = await fetch(`${base}/functions/v1/generate-import-recipe-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        token,
        expense_item_id: item.id,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    setDraftBusy(false);
    if (!res.ok || !payload.ok) {
      setErr(payload.error ?? "Falha ao gerar rascunho IA.");
      return;
    }
    await loadProductOptions();
    await loadDraft();
  }, [token, item.id, loadDraft, loadProductOptions]);

  const approveDraft = async () => {
    if (!draft?.id) return;
    const by = Number(draftBatchYield.replace(",", "."));
    if (!Number.isFinite(by) || by <= 0) {
      setErr("Rendimento da ficha deve ser maior que zero.");
      return;
    }
    setDraftBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "approve_import_recipe_draft_for_recebimento",
      {
        p_token: token,
        p_draft_id: draft.id,
        p_recipe_name: draftRecipeName,
        p_batch_yield: by,
        p_output_product_id: item.product_id ?? null,
      },
    );
    setDraftBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = data as { ok?: boolean; error?: string; recipe_id?: string };
    if (!payload?.ok) {
      setErr(payload?.error ?? "Não foi possível aprovar rascunho.");
      return;
    }
    setDraftOpen(false);
    onSaved();
  };

  const saveDraftComponents = async () => {
    if (!draft?.id) return;
    setDraftBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "update_import_recipe_draft_for_recebimento",
      {
        p_token: token,
        p_draft_id: draft.id,
        p_components: draftComponents.map((c) => ({
          product_id: c.product_id,
          raw_component_name: c.raw_component_name,
          suggested_quantity: c.suggested_quantity,
          suggested_unit: c.suggested_unit,
          loss_factor: c.loss_factor,
          confidence_0_1: c.confidence_0_1,
          match_reason: c.match_reason,
        })),
        p_confidence_0_1: draft.confidence_0_1 ?? null,
        p_reasons_json: null,
      },
    );
    setDraftBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = data as { ok?: boolean; error?: string };
    if (!payload?.ok) {
      setErr(payload?.error ?? "Falha ao salvar componentes do rascunho.");
      return;
    }
    await loadDraft();
  };

  const rejectDraft = async () => {
    if (!draft?.id) return;
    setDraftBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc(
      "reject_import_recipe_draft_for_recebimento",
      {
        p_token: token,
        p_draft_id: draft.id,
        p_reason: "Rejeitado manualmente na conferência do recebimento",
      },
    );
    setDraftBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = data as { ok?: boolean; error?: string };
    if (!payload?.ok) {
      setErr(payload?.error ?? "Falha ao rejeitar rascunho.");
      return;
    }
    setDraftOpen(false);
    onSaved();
  };

  const submitDraftFeedback = async (label: "ACERTOU" | "PARCIAL" | "RUIM") => {
    if (!draft?.id) return;
    setDraftBusy(true);
    setErr(null);
    setDraftFeedbackMsg(null);
    const { data, error } = await supabase.rpc(
      "submit_import_recipe_draft_feedback_for_recebimento",
      {
        p_token: token,
        p_draft_id: draft.id,
        p_feedback_label: label,
        p_feedback_notes: null,
      },
    );
    setDraftBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const payload = data as { ok?: boolean; error?: string };
    if (!payload?.ok) {
      setErr(payload?.error ?? "Falha ao registrar feedback.");
      return;
    }
    setDraftFeedbackMsg(`Feedback registrado: ${label}.`);
    await loadDraft();
  };

  if (!pending) return null;
  const currentRecipeId =
    selectedRecipeId || item.resolved_entry_breakdown_recipe_id || "";
  const currentRecipe = recipeOptions.find((r) => r.id === currentRecipeId);

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
      <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-100">
        <FlaskConical className="h-4 w-4 shrink-0" />
        Resolução de importação
      </div>
      <p className="text-xs text-muted-foreground">
        Este item precisa de conferência antes de movimentar estoque.
        {confPct != null ? ` Confiança sugerida: ${confPct}%.` : ""}
      </p>
      {item.import_engine_suggestion && (
        <p className="text-xs">
          Sugestão do sistema:{" "}
          <span className="font-mono">{item.import_engine_suggestion}</span>
        </p>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || busy}
          onClick={() =>
            void saveResolution({
              import_stock_resolution: "DIRECT",
              resolved_recipe_id: null,
              import_nature: "ESTOQUE_DIRETO",
              suggestion: "AUTO_MATCH_ESTOQUE_DIRETO",
            })
          }
        >
          Dar entrada no produto
        </Button>
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={
            disabled ||
            busy ||
            !(selectedRecipeId || item.resolved_entry_breakdown_recipe_id)
          }
          onClick={() =>
            void saveResolution({
              import_stock_resolution: "EXPLODE_BY_RECIPE",
              resolved_recipe_id:
                selectedRecipeId || item.resolved_entry_breakdown_recipe_id || null,
              import_nature: "EXPLODIR_POR_FICHA",
              suggestion: "AUTO_APPLY_EXPLODIR_FICHA",
            })
          }
        >
          Distribuir pela ficha
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void loadRecipeOptions()}
        >
          Escolher ficha
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void loadPreview()}
        >
          Ver impacto no estoque
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy || draftBusy}
          onClick={() => void generateDraft()}
        >
          Gerar rascunho IA
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy || draftBusy}
          onClick={() => {
            void loadProductOptions();
            void loadDraft();
          }}
        >
          Ver rascunho IA
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            disabled ||
            busy ||
            !currentRecipeId
          }
          onClick={() => setConfirmBulkOpen(true)}
        >
          Aplicar ficha aos pendentes
        </Button>
      </div>
      <Dialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar ficha em lote</DialogTitle>
            <DialogDescription>
              Esta ação aplica a ficha selecionada em todos os itens pendentes
              desta nota. Você poderá revisar antes de confirmar o recebimento.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <p>
              <span className="font-medium">Ficha:</span>{" "}
              {currentRecipe
                ? `${currentRecipe.name} (v${currentRecipe.version})`
                : "Não identificada"}
            </p>
            <p>
              <span className="font-medium">Itens pendentes impactados:</span>{" "}
              {pendingItemsCount}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmBulkOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!currentRecipeId) return;
                setConfirmBulkOpen(false);
                void onApplyRecipeToAllPending?.(currentRecipeId);
              }}
            >
              Aplicar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rascunho IA de ficha de entrada</DialogTitle>
            <DialogDescription>
              Revise os componentes sugeridos e aprove para criar ficha `ENTRY_BREAKDOWN`.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome da ficha</Label>
              <Input
                value={draftRecipeName}
                onChange={(e) => setDraftRecipeName(e.target.value)}
                placeholder="Ex.: Entrada - Caipirinha"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rendimento da ficha</Label>
              <Input
                value={draftBatchYield}
                onChange={(e) => setDraftBatchYield(e.target.value)}
                inputMode="decimal"
                placeholder="1"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-auto rounded border bg-muted/30 p-2 text-xs">
            {!draft ? (
              <p className="text-muted-foreground">Nenhum rascunho disponível para este item.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Confiança:{" "}
                  {draft.confidence_0_1 != null
                    ? `${Math.round(Number(draft.confidence_0_1) * 100)}%`
                    : "n/d"}{" "}
                  · origem: {draft.llm_provider ?? "n/d"} ({draft.llm_model ?? "n/d"})
                </p>
                {draft.components?.length ? (
                  draftComponents.map((c) => (
                    <div
                      key={c.id}
                      className="rounded border bg-background px-2 py-1.5"
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                        <Select
                          value={c.product_id ?? "__none__"}
                          onValueChange={(v) =>
                            setDraftComponents((prev) =>
                              prev.map((x) =>
                                x.id === c.id
                                  ? {
                                      ...x,
                                      product_id: v === "__none__" ? null : v,
                                      product_name:
                                        v === "__none__"
                                          ? null
                                          : productOptions.find((p) => p.id === v)?.name ?? null,
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Produto" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem vínculo</SelectItem>
                            {productOptions.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} ({p.unit})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={c.raw_component_name}
                          onChange={(e) =>
                            setDraftComponents((prev) =>
                              prev.map((x) =>
                                x.id === c.id ? { ...x, raw_component_name: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Componente"
                        />
                        <Input
                          value={String(c.suggested_quantity)}
                          onChange={(e) =>
                            setDraftComponents((prev) =>
                              prev.map((x) =>
                                x.id === c.id
                                  ? { ...x, suggested_quantity: Number(e.target.value || 0) }
                                  : x,
                              ),
                            )
                          }
                          inputMode="decimal"
                          placeholder="Qtd"
                        />
                        <Input
                          value={c.suggested_unit ?? ""}
                          onChange={(e) =>
                            setDraftComponents((prev) =>
                              prev.map((x) =>
                                x.id === c.id ? { ...x, suggested_unit: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Unidade"
                        />
                        <Input
                          value={String(c.loss_factor ?? 1)}
                          onChange={(e) =>
                            setDraftComponents((prev) =>
                              prev.map((x) =>
                                x.id === c.id
                                  ? { ...x, loss_factor: Number(e.target.value || 1) }
                                  : x,
                              ),
                            )
                          }
                          inputMode="decimal"
                          placeholder="Perda"
                        />
                      </div>
                      <div className="mt-2 flex justify-between">
                        <p className="text-muted-foreground">
                          {c.product_name ?? "Produto não mapeado"}{" "}
                          {c.confidence_0_1 != null
                            ? `· conf. ${Math.round(Number(c.confidence_0_1) * 100)}%`
                            : ""}
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraftComponents((prev) => prev.filter((x) => x.id !== c.id))
                          }
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">Rascunho sem componentes válidos.</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraftComponents((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        product_id: null,
                        raw_component_name: "",
                        suggested_quantity: 1,
                        suggested_unit: "un",
                        loss_factor: 1,
                      },
                    ])
                  }
                >
                  Adicionar componente
                </Button>
              </div>
            )}
          </div>
          {draftFeedbackMsg && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {draftFeedbackMsg}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftOpen(false)}>
              Fechar
            </Button>
            <Button
              variant="outline"
              onClick={() => void submitDraftFeedback("ACERTOU")}
              disabled={draftBusy || !draft?.id}
            >
              IA acertou
            </Button>
            <Button
              variant="outline"
              onClick={() => void submitDraftFeedback("PARCIAL")}
              disabled={draftBusy || !draft?.id}
            >
              IA parcial
            </Button>
            <Button
              variant="outline"
              onClick={() => void submitDraftFeedback("RUIM")}
              disabled={draftBusy || !draft?.id}
            >
              IA ruim
            </Button>
            <Button
              variant="outline"
              onClick={() => void rejectDraft()}
              disabled={draftBusy || !draft?.id}
            >
              Rejeitar rascunho
            </Button>
            <Button
              variant="secondary"
              onClick={() => void saveDraftComponents()}
              disabled={draftBusy || !draft?.id || draftComponents.length === 0}
            >
              Salvar rascunho
            </Button>
            <Button
              onClick={() => void approveDraft()}
              disabled={
                draftBusy ||
                !draft?.id ||
                !Array.isArray(draftComponents) ||
                draftComponents.length === 0
              }
            >
              Aprovar e criar ficha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {recipeOptions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Ficha de entrada/desmonte</Label>
            <div className="flex items-center gap-1">
              {sessionSuggestionActive && (
                <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                  Sugerida por sessão
                </span>
              )}
              {recipeOptions.some((r) => r.id === selectedRecipeId && r.is_recommended) && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  Recomendada
                </span>
              )}
            </div>
          </div>
          <Select
            value={selectedRecipeId}
            onValueChange={(v) => {
              setSelectedRecipeId(v);
              onSessionRecipeSelected?.(v);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione uma ficha" />
            </SelectTrigger>
            <SelectContent>
              {recipeOptions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} (v{r.version}) - rendimento {Number(r.batch_yield).toLocaleString("pt-BR")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {recipeOptions.find((r) => r.id === selectedRecipeId)?.recommendation_reason && (
            <p className="text-[11px] text-muted-foreground">
              {recipeOptions.find((r) => r.id === selectedRecipeId)?.recommendation_reason}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          checked={memorize}
          onCheckedChange={(c) => setMemorize(c === true)}
        />
        <Label className="text-xs font-normal cursor-pointer">
          Memorizar para próximas notas (requer login)
        </Label>
      </div>
      {preview != null ? (
        <div className="border-t border-border/60 pt-2 space-y-1">
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-primary"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Preview (componentes)
          </button>
          {open && (
            <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

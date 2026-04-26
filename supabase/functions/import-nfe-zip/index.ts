/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";
import { clampThresholds } from "../_shared/productImport/matchConfig.ts";
import {
  resolveXmlImportLine,
  type EntryBreakdownRecipeRow,
  type ImportResolutionRuleRow,
  type ProductStockRow,
} from "../_shared/productImport/importItemResolutionEngine.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function digitsOnly(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}

function normalizeName(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAscii(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

type CompanyProductCategoryLite = { id: string; name: string };

function detectCategoryConceptsFromImportItem(item: Record<string, unknown>): string[] {
  const name = normalizeAscii(String(item.productName ?? ""));
  const ncm = String(item.ncm ?? "").replace(/\D/g, "");
  const concepts = new Set<string>();

  // Base/fallback para itens de compra de cozinha/estoque.
  concepts.add("insumos");

  // Bebidas e alcoólicos (NCM capítulo 22 e termos comuns).
  if (
    ncm.startsWith("22") ||
    /(agua|suco|refrigerante|energetico|cha|cafe|bebida|nectar)/.test(name)
  ) {
    concepts.add("bebidas");
  }
  if (
    /(cerveja|vinho|vodka|whisky|whiskey|cachaca|rum|gin|tequila|licor|espumante|alcool)/.test(name) ||
    ncm.startsWith("2203") ||
    ncm.startsWith("2204") ||
    ncm.startsWith("2205") ||
    ncm.startsWith("2206") ||
    ncm.startsWith("2208")
  ) {
    concepts.add("alcoolicos");
  }

  // Molhos/condimentos.
  if (
    /(molho|ketchup|mostarda|maionese|shoyu|barbecue|ingles|tabasco|vinagrete)/.test(name)
  ) {
    concepts.add("molhos");
  }

  // Carnes/proteínas.
  if (
    /(carne|bovina|suina|frango|peixe|camarao|linguica|bacon|picanha|costela|file)/.test(name)
  ) {
    concepts.add("carne");
  }

  return [...concepts];
}

function resolveCategoryIdsForConcepts(
  concepts: string[],
  categories: CompanyProductCategoryLite[],
): string[] {
  const normalized = categories.map((c) => ({
    id: c.id,
    nameNorm: normalizeAscii(c.name),
  }));
  const ids = new Set<string>();
  const conceptMatchers: Record<string, string[]> = {
    insumos: ["insumos", "insumo", "mercearia", "cozinha"],
    bebidas: ["bebidas", "bebida"],
    alcoolicos: ["alcoolicos", "alcoolico", "vinhos", "cervejas"],
    molhos: ["molhos", "molho", "condimentos"],
    carne: ["carne", "carnes", "proteinas", "proteina"],
  };
  for (const concept of concepts) {
    const needles = conceptMatchers[concept] ?? [];
    for (const c of normalized) {
      if (needles.some((n) => c.nameNorm.includes(n))) {
        ids.add(c.id);
        break;
      }
    }
  }
  return [...ids];
}

async function loadCompanyProductCategories(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
): Promise<CompanyProductCategoryLite[]> {
  const { data, error } = await supabase
    .from("company_product_categories")
    .select("id, name")
    .eq("company_id", companyId);
  if (error) return [];
  return (data ?? []) as CompanyProductCategoryLite[];
}

async function ensureImportCategoryPool(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
): Promise<CompanyProductCategoryLite[]> {
  const wanted = [
    { name: "Insumos", sort_order: 24 },
    { name: "Bebidas", sort_order: 2 },
    { name: "Alcoólicos", sort_order: 1 },
    { name: "Molhos", sort_order: 26 },
    { name: "Proteínas", sort_order: 32 },
  ];
  // Idempotente: se já existir, não duplica.
  await supabase
    .from("company_product_categories")
    .upsert(
      wanted.map((w) => ({
        company_id: companyId,
        name: w.name,
        sort_order: w.sort_order,
      })),
      { onConflict: "company_id,name", ignoreDuplicates: true },
    );
  return loadCompanyProductCategories(supabase, companyId);
}

async function assignCategoriesToProducts(
  supabase: ReturnType<typeof createClient>,
  assignments: Array<{ product_id: string; category_id: string }>,
) {
  if (!assignments.length) return;
  await supabase
    .from("product_category_assignments")
    .upsert(assignments, { onConflict: "product_id,category_id", ignoreDuplicates: true });
}

function mapInvoiceUnitToSystem(
  raw: string | null | undefined,
  customAliases: Array<{ unit_code: string; source_hint?: string | null; unit_label?: string | null }> = [],
): {
  unit: string;
  needsReview: boolean;
  rawUnit: string | null;
} {
  const original = String(raw ?? "").trim();
  if (!original) {
    return { unit: "un", needsReview: true, rawUnit: null };
  }
  const t = normalizeAscii(original);
  for (const row of customAliases) {
    const code = String(row.unit_code ?? "").trim().toLowerCase();
    if (!code) continue;
    const hint = normalizeAscii(String(row.source_hint ?? ""));
    const label = normalizeAscii(String(row.unit_label ?? ""));
    if ((hint && hint === t) || (label && label === t) || code === t) {
      return { unit: code, needsReview: false, rawUnit: original };
    }
  }
  const aliases: Record<string, string> = {
    un: "un",
    und: "un",
    unid: "un",
    unidade: "un",
    unit: "un",
    pc: "pc",
    peca: "pc",
    pec: "pc",
    pt: "pc",
    cx: "cx",
    caixa: "cx",
    caixas: "cx",
    pct: "pct",
    pac: "pct",
    pcte: "pct",
    pacote: "pct",
    pacotes: "pct",
    kg: "kg",
    g: "g",
    grama: "g",
    gramas: "g",
    l: "l",
    litro: "l",
    litros: "l",
    ml: "ml",
    mililitro: "ml",
    mililitros: "ml",
    garrafa: "garrafa",
    frasco: "frasco",
    galao: "galao",
    lata: "lata",
    pote: "pote",
    rolo: "rolo",
    saco: "saco",
    bandeja: "bandeja",
    barrica: "barrica",
    tambor: "tambor",
    fardo: "fd",
    fd: "fd",
    bisnaga: "bisnaga",
    maco: "maco",
  };
  if (aliases[t]) {
    return { unit: aliases[t], needsReview: false, rawUnit: original };
  }

  // aproximação simples para casos truncados (ex.: "peç"/"pec")
  if (t.startsWith("pec")) {
    return { unit: "pc", needsReview: false, rawUnit: original };
  }
  if (t.startsWith("pac")) {
    return { unit: "pct", needsReview: false, rawUnit: original };
  }
  if (t.startsWith("caix")) {
    return { unit: "cx", needsReview: false, rawUnit: original };
  }

  const legacy = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 24);
  return {
    unit: legacy || "un",
    needsReview: true,
    rawUnit: original,
  };
}

async function findOrCreateProduct(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  item: Record<string, unknown>,
  customAliases: Array<{ unit_code: string; source_hint?: string | null; unit_label?: string | null }> = [],
): Promise<{ productId: string | null; needsReview: boolean; reason?: string }> {
  const name = String(item.productName ?? "").trim() || "Item";
  const mappedUnit = mapInvoiceUnitToSystem(
    String(item.unitCommercial ?? "").trim() || "un",
    customAliases,
  );
  const unit = mappedUnit.unit;
  const sku = String(item.productCode ?? "").trim();
  const nname = normalizeName(name);

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, name, unit, sku, is_active")
    .eq("company_id", companyId);
  if (pErr) {
    return { productId: null, needsReview: true, reason: pErr.message };
  }
  const rows = (products ?? []) as Array<{
    id: string;
    name: string;
    unit?: string | null;
    sku?: string | null;
    is_active?: boolean | null;
  }>;

  const bySku = sku
    ? rows.find((p) => (p.sku ?? "").trim().toLowerCase() === sku.toLowerCase())
    : null;
  if (bySku) {
    const existingUnit = String(bySku.unit ?? "un").trim().toLowerCase();
    if (existingUnit !== unit.toLowerCase()) {
      return {
        productId: null,
        needsReview: true,
        reason: `Conflito de unidade para SKU ${sku} (${existingUnit} x ${unit})`,
      };
    }
    return { productId: bySku.id, needsReview: false };
  }

  const exact = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() === unit.toLowerCase()
  );
  if (exact) {
    return { productId: exact.id, needsReview: false };
  }

  const sameNameDifferentUnit = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() !== unit.toLowerCase()
  );
  if (sameNameDifferentUnit) {
    return {
      productId: null,
      needsReview: true,
      reason: `Produto "${name}" com unidade divergente (${sameNameDifferentUnit.unit} x ${unit})`,
    };
  }

  const { data: created, error: cErr } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name,
      unit,
      sku: sku || null,
      current_quantity: 0,
      import_unit_raw: mappedUnit.rawUnit,
      import_unit_needs_review: mappedUnit.needsReview,
    })
    .select("id")
    .single();
  if (cErr) {
    return { productId: null, needsReview: true, reason: cErr.message };
  }
  return { productId: (created?.id as string) ?? null, needsReview: false };
}

async function insertImportLog(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("company_nfe_import_logs").insert(payload);
  return error;
}

async function loadImportResolutionContext(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{
  thresholds: { autoMatchMinScore: number; confirmMinScore: number };
  rules: ImportResolutionRuleRow[];
  productsById: Map<string, ProductStockRow>;
  entryBreakdownRecipes: EntryBreakdownRecipeRow[];
  customUnitAliases: Array<{ unit_code: string; source_hint?: string | null; unit_label?: string | null }>;
}> {
  const [{ data: settings }, { data: rules }, { data: prods }, { data: recipes }, { data: unitAliases }] = await Promise.all([
    supabase
      .from("company_product_import_settings")
      .select("auto_match_min_score, confirm_min_score")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase.from("import_item_resolution_rules").select("*").eq("company_id", companyId),
    supabase
      .from("products")
      .select("id, stock_control_type")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .from("recipes")
      .select("id, output_product_id, batch_yield, active, recipe_type, version")
      .eq("company_id", companyId),
    supabase
      .from("company_custom_unit_aliases")
      .select("unit_code, source_hint, unit_label")
      .eq("company_id", companyId),
  ]);

  const thresholds = clampThresholds({
    autoMatchMinScore: (settings as { auto_match_min_score?: number } | null)?.auto_match_min_score,
    confirmMinScore: (settings as { confirm_min_score?: number } | null)?.confirm_min_score,
  });

  const productsById = new Map<string, ProductStockRow>();
  for (const p of (prods ?? []) as Array<{ id: string; stock_control_type?: string | null }>) {
    const t = (p.stock_control_type ?? "DIRECT") as ProductStockRow["stock_control_type"];
    productsById.set(p.id, { id: p.id, stock_control_type: t });
  }

  const entryBreakdownRecipes = ((recipes ?? []) as EntryBreakdownRecipeRow[]).map((r) => ({
    id: r.id,
    output_product_id: r.output_product_id ?? null,
    batch_yield: Number(r.batch_yield) || 1,
    active: r.active === true,
    recipe_type: String(r.recipe_type ?? "SALE"),
    version: Number(r.version) || 1,
  }));

  const ruleRows = (rules ?? []) as ImportResolutionRuleRow[];

  return {
    thresholds,
    rules: ruleRows,
    productsById,
    entryBreakdownRecipes,
    customUnitAliases: (unitAliases ?? []) as Array<{
      unit_code: string;
      source_hint?: string | null;
      unit_label?: string | null;
    }>,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "Sessão inválida." }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Body inválido." }, 400);
  }
  const companyId = String(form.get("company_id") ?? "").trim();
  const file = form.get("file");
  if (!companyId) return json({ ok: false, error: "company_id é obrigatório." }, 400);
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "Arquivo ZIP ausente." }, 400);
  }

  const { data: member, error: memErr } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (memErr || !member) return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    return json({ ok: false, error: "ZIP inválido ou corrompido." }, 422);
  }

  const entries = Object.entries(unzipped).filter(([name, content]) =>
    name.toLowerCase().endsWith(".xml") && content && content.length > 0
  );
  if (!entries.length) {
    return json({ ok: false, error: "Nenhum XML válido encontrado no ZIP." }, 422);
  }

  const logs: Array<{ name: string; ok: boolean; status: string; message: string }> = [];
  let successCount = 0;

  for (const [entryName, xmlBytes] of entries) {
    const xmlHash = sha256Hex(xmlBytes);
    const xmlText = strFromU8(xmlBytes);
    const extracted = parseNfeXmlToExtracted(xmlText);
    if (!extracted) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        status: "read_error",
        error_message: "XML inválido para NF-e autorizada (nfeProc).",
      });
      logs.push({
        name: entryName,
        ok: false,
        status: "read_error",
        message: "Erro de leitura: XML inválido.",
      });
      continue;
    }

    const data = enrichExtractedWithTaxId(extracted);
    const nfeAccessKey = String(data.nfeAccessKey ?? "").trim() || null;
    const invoiceNumber = String(data.invoiceNumber ?? "").trim() || null;
    const invoiceSeries = String(data.invoiceSeries ?? "").trim() || null;
    const supplierDocument = digitsOnly(data.supplierDocument);
    const emissionDate = String(data.emissionDate ?? "").slice(0, 10) || null;

    const { data: alreadyByHash } = await supabase
      .from("company_nfe_import_logs")
      .select("id")
      .eq("company_id", companyId)
      .eq("xml_hash", xmlHash)
      .maybeSingle();
    if (alreadyByHash) {
      logs.push({ name: entryName, ok: false, status: "duplicate", message: "Ignorado: XML já importado." });
      continue;
    }

    if (nfeAccessKey) {
      const { data: byKey } = await supabase
        .from("company_nfe_import_logs")
        .select("id")
        .eq("company_id", companyId)
        .eq("nfe_access_key", nfeAccessKey)
        .maybeSingle();
      if (byKey) {
        await insertImportLog(supabase, {
          company_id: companyId,
          file_name: entryName,
          xml_hash: xmlHash,
          nfe_access_key: nfeAccessKey,
          invoice_number: invoiceNumber,
          invoice_series: invoiceSeries,
          supplier_document: supplierDocument,
          emission_date: emissionDate,
          status: "duplicate",
          error_message: "Nota já importada por chave de acesso.",
        });
        logs.push({ name: entryName, ok: false, status: "duplicate", message: "Ignorado: chave de acesso já importada." });
        continue;
      }
    }

    const supplierId = await ensureSupplierFromExtracted(
      supabase,
      companyId,
      data,
      "Cadastrado automaticamente — importação XML/ZIP NF-e",
    );
    const rctx = await loadImportResolutionContext(supabase, companyId);

    const companyCategories = await ensureImportCategoryPool(supabase, companyId);
    const match = await resolveProductMatches(supabase, companyId, data.items ?? []);
    const finalItems: Array<Record<string, unknown>> = [];
    let needsReviewReason: string | null = null;
    for (const item of match.items ?? []) {
      const pm = item.productMatch as Record<string, unknown> | undefined;
      const resolvedProductId = String(pm?.resolvedProductId ?? "").trim() || null;
      const needsConfirmation = pm?.needsConfirmation === true;
      if (needsConfirmation && resolvedProductId) {
        needsReviewReason = `Conflito de unidade para item "${item.productName}"`;
        break;
      }
      if (needsConfirmation && !resolvedProductId) {
        const created = await findOrCreateProduct(
          supabase,
          companyId,
          item as Record<string, unknown>,
          rctx.customUnitAliases,
        );
        if (created.needsReview || !created.productId) {
          needsReviewReason = created.reason ?? `Baixa confiança no match para "${item.productName}"`;
          break;
        }
        finalItems.push({
          ...item,
          productId: created.productId,
          detectedCategoryConcepts: detectCategoryConceptsFromImportItem(
            item as Record<string, unknown>,
          ),
        });
      } else if (resolvedProductId) {
        finalItems.push({
          ...item,
          productId: resolvedProductId,
          detectedCategoryConcepts: detectCategoryConceptsFromImportItem(
            item as Record<string, unknown>,
          ),
        });
      } else {
        const created = await findOrCreateProduct(
          supabase,
          companyId,
          item as Record<string, unknown>,
          rctx.customUnitAliases,
        );
        if (created.needsReview || !created.productId) {
          needsReviewReason = created.reason ?? `Nao foi possivel resolver "${item.productName}"`;
          break;
        }
        finalItems.push({
          ...item,
          productId: created.productId,
          detectedCategoryConcepts: detectCategoryConceptsFromImportItem(
            item as Record<string, unknown>,
          ),
        });
      }
    }

    const categoryAssignments: Array<{ product_id: string; category_id: string }> = [];
    const dedupeAssignments = new Set<string>();
    for (const it of finalItems) {
      const pid = String((it as { productId?: string | null }).productId ?? "").trim();
      if (!pid) continue;
      const concepts = ((it as { detectedCategoryConcepts?: string[] }).detectedCategoryConcepts ??
        []) as string[];
      const categoryIds = resolveCategoryIdsForConcepts(concepts, companyCategories);
      for (const cid of categoryIds) {
        const key = `${pid}:${cid}`;
        if (dedupeAssignments.has(key)) continue;
        dedupeAssignments.add(key);
        categoryAssignments.push({ product_id: pid, category_id: cid });
      }
    }
    await assignCategoriesToProducts(supabase, categoryAssignments);

    let deferReceiptForResolution = false;
    if (!needsReviewReason && finalItems.length) {
      for (const it of finalItems) {
        const pm = (it as { productMatch?: Record<string, unknown> }).productMatch;
        const res = resolveXmlImportLine({
          companyId,
          supplierId,
          item: {
            productName: String((it as { productName?: string }).productName ?? ""),
            quantity: Number((it as { quantity?: number }).quantity ?? 0),
            unitCommercial: (it as { unitCommercial?: string | null }).unitCommercial ?? null,
            ncm: (it as { ncm?: string | null }).ncm ?? null,
            ean: (it as { ean?: string | null }).ean ?? null,
            productMatch: pm
              ? {
                  resolvedProductId: (pm.resolvedProductId as string | null) ?? null,
                  suggestedProductId: (pm.suggestedProductId as string | null) ?? null,
                  suggestedScore: Number(pm.suggestedScore ?? 0),
                  needsConfirmation: pm.needsConfirmation === true,
                  resolutionStatus: String(pm.resolutionStatus ?? ""),
                  matchReason: typeof pm.matchReason === "string" ? pm.matchReason : undefined,
                }
              : undefined,
          },
          rules: rctx.rules,
          productsById: rctx.productsById,
          entryBreakdownRecipes: rctx.entryBreakdownRecipes,
          thresholds: rctx.thresholds,
        });
        (it as { importResolution?: typeof res }).importResolution = res;
        if (res.import_pending_resolution) deferReceiptForResolution = true;
        const tid = res.target_product_id;
        if (tid) {
          (it as { productId?: string | null }).productId = tid;
        }
      }
    }

    if (needsReviewReason) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "needs_review",
        error_message: needsReviewReason,
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "needs_review", message: needsReviewReason });
      continue;
    }

    const notes =
      `Importado via ZIP/XML no setup` +
      (nfeAccessKey ? ` — chave ${nfeAccessKey}` : "");
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .insert({
        company_id: companyId,
        created_by: user.id,
        type: "nota_fiscal",
        expense_source: "manual",
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_id: supplierId,
        supplier_document: data.supplierDocument,
        supplier_name: data.supplierName,
        status: "pending",
        notes,
        document_total: Number(data.totalAmount ?? 0) || null,
      })
      .select("id")
      .single();

    if (expErr || !expense?.id) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "validation_error",
        error_message: expErr?.message ?? "Falha ao criar despesa.",
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "validation_error", message: expErr?.message ?? "Falha ao criar despesa." });
      continue;
    }

    const expenseId = expense.id as string;
    const insertedItemIds: Array<{ expense_item_id: string; status: string; quantity_received: number }> = [];
    for (const it of finalItems) {
      const q = Math.max(0.0001, Number(it.quantity ?? 0));
      const uv = Number(it.unitValue ?? 0);
      const invUnit = String(it.unitCommercial ?? "").trim() || null;
      const stockQty = Number((it.productMatch as Record<string, unknown> | undefined)?.stockQuantity ?? q);
      const res = (it as { importResolution?: Record<string, unknown> }).importResolution as
        | {
            import_nature?: string;
            import_engine_suggestion?: string;
            import_confidence_0_1?: number;
            import_score_reasons_json?: Record<string, unknown>;
            import_stock_resolution?: string | null;
            resolved_entry_breakdown_recipe_id?: string | null;
            import_pending_resolution?: boolean;
            import_applied_rule_id?: string | null;
          }
        | undefined;
      const { data: insItem, error: itemErr } = await supabase
        .from("expense_items")
        .insert({
          expense_id: expenseId,
          product_name: String(it.productName ?? "Item"),
          quantity: q,
          unit_value: uv,
          product_id: String(it.productId ?? "").trim() || null,
          invoice_unit: invUnit,
          stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
          stock_added: false,
          import_nature: res?.import_nature ?? null,
          import_engine_suggestion: res?.import_engine_suggestion ?? null,
          import_confidence_0_1: res?.import_confidence_0_1 ?? null,
          import_score_reasons_json: res?.import_score_reasons_json ?? null,
          import_stock_resolution: res?.import_stock_resolution ?? null,
          resolved_entry_breakdown_recipe_id: res?.resolved_entry_breakdown_recipe_id ?? null,
          import_pending_resolution: res?.import_pending_resolution ?? false,
          import_applied_rule_id: res?.import_applied_rule_id ?? null,
        })
        .select("id")
        .single();
      if (itemErr || !insItem?.id) {
        needsReviewReason = itemErr?.message ?? "Falha ao inserir itens";
        break;
      }
      insertedItemIds.push({
        expense_item_id: String(insItem.id),
        status: "received",
        quantity_received: Number.isFinite(stockQty) ? stockQty : q,
      });
    }

    if (needsReviewReason) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "needs_review",
        error_message: needsReviewReason,
        expense_id: expenseId,
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "needs_review", message: needsReviewReason });
      continue;
    }

    const { data: rec, error: recErr } = await supabase
      .from("recebimentos")
      .insert({ expense_id: expenseId })
      .select("token")
      .single();
    if (!deferReceiptForResolution && !recErr && rec?.token) {
      await supabase.rpc("confirmar_recebimento", {
        p_token: rec.token,
        p_items: insertedItemIds,
      });
    }

    await insertImportLog(supabase, {
      company_id: companyId,
      file_name: entryName,
      xml_hash: xmlHash,
      nfe_access_key: nfeAccessKey,
      invoice_number: invoiceNumber,
      invoice_series: invoiceSeries,
      supplier_document: supplierDocument,
      emission_date: emissionDate,
      status: "success",
      expense_id: expenseId,
      payload: data,
    });
    logs.push({
      name: entryName,
      ok: true,
      status: "success",
      message: deferReceiptForResolution
        ? "Importado. Conclua a resolução de itens (ficha/estoque) no link de recebimento antes de confirmar."
        : "Importado com sucesso.",
    });
    successCount += 1;
  }

  return json({
    ok: true,
    summary: {
      total_xml: entries.length,
      success: successCount,
      failed: entries.length - successCount,
    },
    files: logs,
  });
});

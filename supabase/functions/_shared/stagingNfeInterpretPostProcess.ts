/**
 * Pós-processamento após `interpretStagingNfeXmlForLog`: fornecedor, produtos
 * (identificadores do XML), persistência de despesa + boletos (NF-e staging).
 * Inserções reais: `suppliers` (quando ausente), `products`+entrada atômica (RPC
 * `create_product_with_stock_in`), `product_supplier_codes`, `expenses` / `expense_items` / `boletos`.
 * Produto novo só nasce com movimentação de entrada na mesma transação.
 * Match determinístico: EAN, cProd+fornecedor, SKU, nome, NCM, aliases e histórico do fornecedor.
 */
import {
  ensureSupplierFromExtracted,
  normalizeTaxIdForSupplierDocument,
} from "./expenseSupplierEnsure.ts";
import { isNfeBonificationCfop } from "./nfeCfopBonification.ts";
import type { ExtractedDocumentResult } from "./openaiExpense.ts";
import { createProductWithStockIn } from "./createProductWithStockIn.ts";
import { fetchProductDefaultExpenseCategoryById } from "./productDefaultExpenseCategory.ts";
import {
  fetchCompanyNcmCategoryMap,
  lookupNcmProductRule,
  applyNcmProductRuleToNewProduct,
  ensureProductCatalogTag,
  ncmKeyForCategoryRule,
  resolvePurchaseCategoryId,
} from "./ncmCategoryRule.ts";
import { buildNewProductCatalogFromNfeLine } from "./productImport/buildPackUnitConversionsFromLabel.ts";
import { canonicalProductName } from "./productImport/canonicalName.ts";
import { catalogMatchNameKey } from "./productImport/llmCatalogCandidates.ts";
import {
  loadSupplierProductMatchHints,
  matchExistingProductFromNfeXmlLine,
  previewActionForMatchCriterio,
} from "./productImport/matchExistingProductFromNfeXml.ts";
import {
  matchProductBySupplierCertainty,
  toLegacyMatchResult,
} from "./productImport/matchProductBySupplierCertainty.ts";
import {
  normalizeCProd,
  upsertProductSupplierCode as upsertProductSupplierCodeShared,
} from "./productImport/productSupplierCodes.ts";
import type { StagingNfeInterpretLog } from "./stagingNfeInterpretLog.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

const LOG = "[stagingNfeInterpretPostProcess]";

export type StagingInterpretPreviewPlannedProduct = {
  preview_product_id: string;
  name: string;
  unit: string;
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  ean: string | null;
  conversions: Array<{
    primary_qty: number;
    primary_unit_code: string;
    secondary_qty: number;
    secondary_unit_code: string;
    relation?: string;
  }>;
  registration_note: string | null;
  estoque_entrada_preview?: Record<string, unknown>;
  criterio_criacao: string;
  criterio_descricao: string;
};

export type StagingInterpretPreviewLine = {
  line_index: number;
  nome: string;
  codigo: string | null;
  ncm: string | null;
  ean: string | null;
  cfop: string | null;
  action:
    | "skip_fiscal_incomplete"
    | "reuse_chunk_dedupe"
    | "link_ean"
    | "link_cprod_supplier"
    | "link_sku_cprod"
    | "link_canonical_name"
    | "link_ncm_nome"
    | "link_nome"
    | "link_merged_alias"
    | "link_historico_fornecedor"
    | "create_product";
  product_id: string | null;
  product_name?: string | null;
  criterio?: string;
  planned_product?: StagingInterpretPreviewPlannedProduct;
};

export type StagingInterpretPreviewResult = {
  supplier: {
    document_digits: string | null;
    action: "invalid_document" | "link_existing" | "would_create";
    existing_supplier_id?: string | null;
    existing_supplier_name?: string | null;
    planned_insert?: { name: string; document: string; notes: string };
  };
  products_by_line: StagingInterpretPreviewLine[];
  expense: {
    would_create: boolean;
    skip_reason?: string;
    duplicate_expense_id?: string | null;
    supplier_id_for_expense: string | null;
    supplier_created_for_expense: boolean;
    document_total: number | null;
    financial_reconciliation_json: Record<string, unknown>;
    planned_expense: Record<string, unknown> | null;
    planned_items: Array<Record<string, unknown>>;
    would_finalize_recebimento_and_stock: boolean;
  };
  boletos: Array<Record<string, unknown>>;
  meta: {
    catalog_size: number;
    openai_configured: boolean;
    catalog_fetch_error: string | null;
    unified_catalog_note: string;
  };
};

export type StagingInterpretPreviewSink = {
  readonly isPreview: true;
  lines: StagingInterpretPreviewLine[];
  supplier: StagingInterpretPreviewResult["supplier"] | null;
  expense: StagingInterpretPreviewResult["expense"] | null;
  boletos: StagingInterpretPreviewResult["boletos"];
  catalog_size: number;
  openai_configured: boolean;
  catalog_fetch_error: string | null;
};

export function createStagingInterpretPreviewSink(
  catalogSize: number,
  catalogFetchError: string | null,
): StagingInterpretPreviewSink {
  return {
    isPreview: true,
    lines: [],
    supplier: null,
    expense: null,
    boletos: [],
    catalog_size: catalogSize,
    openai_configured: false,
    catalog_fetch_error: catalogFetchError,
  };
}

function previewLineBase(
  lineIndex: number,
  line: StagingNfeInterpretLog["produtos"][number],
): Pick<
  StagingInterpretPreviewLine,
  "line_index" | "nome" | "codigo" | "ncm" | "ean" | "cfop"
> {
  return {
    line_index: lineIndex,
    nome: String(line.nome ?? "").trim() || "Item",
    codigo: line.codigo != null ? String(line.codigo).trim() || null : null,
    ncm: line.ncm ?? null,
    ean: line.ean ?? null,
    cfop: line.cfop ?? null,
  };
}

function recordPreviewLine(
  sink: StagingInterpretPreviewSink,
  lineIndex: number,
  line: StagingNfeInterpretLog["produtos"][number],
  rest: Omit<
    StagingInterpretPreviewLine,
    keyof ReturnType<typeof previewLineBase>
  >,
): void {
  sink.lines[lineIndex] = { ...previewLineBase(lineIndex, line), ...rest };
}

function plannedProductFromBuilt(
  previewId: string,
  built: NonNullable<ReturnType<typeof productInsertPayload>>,
  contexto: string,
): StagingInterpretPreviewPlannedProduct {
  const p = built.payload;
  return {
    preview_product_id: previewId,
    name: String(p.name ?? ""),
    unit: String(p.unit ?? "un"),
    ncm: p.ncm != null ? String(p.ncm) : null,
    cfop: p.cfop != null ? String(p.cfop) : null,
    csosn: p.csosn != null ? String(p.csosn) : null,
    ean: p.ean != null ? String(p.ean) : null,
    conversions: built.conversions.map((c) => ({
      primary_qty: c.primary_qty,
      primary_unit_code: c.primary_unit_code,
      secondary_qty: c.secondary_qty,
      secondary_unit_code: c.secondary_unit_code,
    })),
    registration_note: built.registrationNote,
    estoque_entrada_preview:
      p.estoque_entrada_preview != null &&
      typeof p.estoque_entrada_preview === "object"
        ? (p.estoque_entrada_preview as Record<string, unknown>)
        : undefined,
    criterio_criacao: contexto,
    criterio_descricao: criterioProdutoCriadoLabel(contexto),
  };
}

/** NCM com 8 dígitos: 2–7 dígitos recebem zeros à esquerda; 1 dígito ou vazio = inválido. */
function normalizeNcm8(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (d.length < 1) return null;
  if (d.length < 8) return d.padStart(8, "0");
  return d.slice(0, 8);
}

function normalizeOptionalCfop(
  line: StagingNfeInterpretLog["produtos"][number],
): string | null {
  const cfop = String(line.cfop ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  return cfop.length === 4 ? cfop : null;
}

function normalizeOptionalCsosn(
  line: StagingNfeInterpretLog["produtos"][number],
): string | null {
  const csosn = String(line.csosn ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  return csosn.length >= 2 ? csosn : null;
}

/** NCM (8 dígitos) obrigatório; CFOP e CSOSN/CST opcionais quando presentes no XML. */
function normalizeLineFiscalForProduct(
  line: StagingNfeInterpretLog["produtos"][number],
): { ncm: string; cfop: string | null; csosn: string | null } | null {
  const ncm = normalizeNcm8(line.ncm);
  if (!ncm) return null;
  return {
    ncm,
    cfop: normalizeOptionalCfop(line),
    csosn: normalizeOptionalCsosn(line),
  };
}

function logProductSkipFiscalIncomplete(
  line: StagingNfeInterpretLog["produtos"][number],
  motivo: string,
): void {
  console.error(
    LOG,
    "produto_skip_fiscal_incompleto",
    JSON.stringify({
      motivo,
      nome: String(line.nome ?? "").trim() || "—",
      ncm: line.ncm ?? null,
      cfop: line.cfop ?? null,
      csosn: line.csosn ?? null,
    }),
  );
}

function productInsertPayload(
  companyId: string,
  line: StagingNfeInterpretLog["produtos"][number],
): {
  payload: Record<string, unknown>;
  conversions: ReturnType<
    typeof buildNewProductCatalogFromNfeLine
  >["conversions"];
  registrationNote: string | null;
} {
  const fiscal = normalizeLineFiscalForProduct(line);
  const catalog = buildNewProductCatalogFromNfeLine({
    productName: String(line.nome ?? "").trim() || "Item",
    invoiceUnitRaw: line.unidade_comercial,
    unitCommercial: line.unidade_comercial,
    unitTax: line.unidade_tributavel,
    quantityCommercial: line.quantidade_comercial ?? line.quantidade,
    quantityTax: line.quantidade_tributavel,
  });
  const name = catalog.catalogName.slice(0, 512) || "Produto (NF-e)";
  const unit = catalog.stockUnit.slice(0, 32) || "un";
  const eanDigits = line.ean != null ? String(line.ean).replace(/\D/g, "") : "";
  return {
    payload: {
      company_id: companyId,
      name,
      unit,
      ncm: fiscal?.ncm ?? null,
      cfop: fiscal?.cfop ?? normalizeOptionalCfop(line),
      csosn: fiscal?.csosn ?? normalizeOptionalCsosn(line),
      ean: eanDigits.length > 0 ? eanDigits : null,
      min_quantity: 0,
      current_quantity: 0,
    },
    conversions: catalog.conversions,
    registrationNote: catalog.registrationNote,
  };
}

/** Colunas válidas em `products` (exclui preview JSON só para log). */
function productRowForDbInsert(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    company_id,
    name,
    unit,
    ncm,
    cfop,
    csosn,
    ean,
    min_quantity,
    current_quantity,
    default_expense_category_id,
  } = payload;
  const ncmStr = normalizeNcm8(ncm != null ? String(ncm) : null);
  const cfopRaw =
    cfop != null ? String(cfop).replace(/\D/g, "").slice(0, 4) : "";
  const csosnRaw =
    csosn != null ? String(csosn).replace(/\D/g, "").slice(0, 4) : "";
  const cn = canonicalProductName(String(name ?? ""));
  const defaultCat =
    default_expense_category_id != null
      ? String(default_expense_category_id).trim()
      : "";
  return {
    company_id,
    name,
    unit,
    ncm: ncmStr,
    cfop: cfopRaw.length === 4 ? cfopRaw : null,
    csosn: csosnRaw.length >= 2 ? csosnRaw : null,
    ean: ean ?? null,
    min_quantity: min_quantity ?? 0,
    current_quantity: current_quantity ?? 0,
    canonical_name: cn.length >= 2 ? cn : null,
    is_active: true,
    stock_control_type: "DIRECT",
    ...(defaultCat ? { default_expense_category_id: defaultCat } : {}),
  };
}

async function insertProductFromStagingInterpret(
  admin: SupabaseAdmin,
  companyId: string,
  payload: Record<string, unknown>,
  conversions: ReturnType<
    typeof buildNewProductCatalogFromNfeLine
  >["conversions"],
  contexto: string,
  stock: { quantity: number; unitValue: number } | null,
  supplierId: string | null,
): Promise<{ productId: string | null; stockApplied: boolean }> {
  const row = productRowForDbInsert(payload);
  const ncmRule = await lookupNcmProductRule(admin, companyId, row.ncm);
  applyNcmProductRuleToNewProduct(row, ncmRule);

  // Fluxo steady: cadastra produto sem entrada de stock (aguarda recebimento).
  if (!stock) {
    const tagId = String(row.product_category_id ?? "").trim();
    const insertPayload: Record<string, unknown> = {
      ...row,
      company_id: companyId,
      current_quantity: 0,
    };
    delete insertPayload.product_category_id;
    if (conversions.length > 0) {
      insertPayload.unit_conversions = conversions;
    }
    const { data: ins, error: insErr } = await admin
      .from("products")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr || !ins?.id) {
      console.error(
        LOG,
        "produto_insert_sem_estoque_err",
        contexto,
        insErr?.message ?? "sem_id",
        JSON.stringify({ nome: row.name ?? null }),
      );
      return { productId: null, stockApplied: false };
    }
    const createdId = String(ins.id);
    if (tagId) {
      await ensureProductCatalogTag(admin, companyId, createdId, tagId);
    }
    return { productId: createdId, stockApplied: false };
  }

  const created = await createProductWithStockIn(admin, {
    companyId,
    product: row,
    quantity: stock.quantity,
    unitValue: stock.unitValue,
    referenceType: "nfe_staging_create",
    referenceId: supplierId && !supplierId.startsWith("preview:")
      ? supplierId
      : null,
    unitConversions: conversions,
  });
  if (created.error || !created.productId) {
    console.error(
      LOG,
      "produto_insert_com_estoque_err",
      contexto,
      created.error ?? "sem_id",
      JSON.stringify({
        qty: stock.quantity,
        unit_value: stock.unitValue,
        nome: row.name ?? null,
      }),
    );
    return { productId: null, stockApplied: false };
  }
  return { productId: created.productId, stockApplied: true };
}

const CRITERIO_PRODUTO_CRIADO: Record<string, string> = {
  sem_identificador_existente:
    "Nenhum produto do fornecedor com certeza (cProd/EAN/SKU); cadastro criado a partir da linha da NF-e",
};

function criterioProdutoCriadoLabel(contexto: string): string {
  return CRITERIO_PRODUTO_CRIADO[contexto] ?? contexto;
}

/** Chave estável (cProd + EAN + NCM + nome): reuso no chunk e na mesma NF sem novo insert. */
function stagingLineProductDedupeKey(
  line: StagingNfeInterpretLog["produtos"][number],
): string {
  const cProd = normalizeCProd(line.codigo) ?? "_";
  const n8 = normalizeNcm8(line.ncm) ?? "_";
  const ean = String(line.ean ?? "").replace(/\D/g, "") || "_";
  const nome = String(line.nome ?? "").trim().toLowerCase();
  return `${cProd}\x1f${n8}\x1f${ean}\x1f${nome}`;
}

function catalogRowFromStagingInsert(
  id: string,
  payload: Record<string, unknown>,
): StagingInterpretProductCatalogRow {
  const eanDigits =
    payload.ean != null ? String(payload.ean).replace(/\D/g, "") : "";
  const cn = canonicalProductName(String(payload.name ?? ""));
  return {
    id,
    name: String(payload.name ?? ""),
    ncm: payload.ncm != null ? String(payload.ncm).trim() || null : null,
    cfop: payload.cfop != null ? String(payload.cfop).trim() || null : null,
    csosn: payload.csosn != null ? String(payload.csosn).trim() || null : null,
    ean: eanDigits.length > 0 ? eanDigits : null,
    barcode: null,
    unit: payload.unit != null ? String(payload.unit).trim() || null : null,
    sku: null,
    canonical_name: cn.length >= 2 ? cn : null,
    merged_catalog_names: null,
    is_active: true,
  };
}

/** Atualiza catálogo em memória e buckets NCM após insert (mesmo chunk / notas seguintes). */
function registerNewProductInStagingCatalog(
  catalog: StagingInterpretProductCatalogRow[],
  ncmBuckets: Map<string, StagingInterpretProductCatalogRow[]>,
  row: StagingInterpretProductCatalogRow,
): void {
  catalog.push(row);
  const n8 = normalizeNcm8(row.ncm);
  if (!n8) return;
  const arr = ncmBuckets.get(n8) ?? [];
  arr.push(row);
  ncmBuckets.set(n8, arr);
}

async function stagingInterpretCreateProduct(
  admin: SupabaseAdmin,
  companyId: string,
  catalog: StagingInterpretProductCatalogRow[],
  ncmBuckets: Map<string, StagingInterpretProductCatalogRow[]>,
  chunkProductDedupeByKey: Map<string, string>,
  dedupeKey: string,
  built: ReturnType<typeof productInsertPayload>,
  contexto: string,
  line: StagingNfeInterpretLog["produtos"][number],
  preview?: {
    sink: StagingInterpretPreviewSink;
    lineIndex: number;
  },
  applyStockOnCreate = true,
  supplierId: string | null = null,
): Promise<{ productId: string | null; stockApplied: boolean }> {
  const nomeProduto = String(built.payload.name ?? "").trim() || "—";
  const stockQty = Math.max(0, Number(line.quantidade) || 0);
  const stockUnitValue =
    Math.round((Number(line.valor_unitario) || 0) * 100) / 100;

  if (preview) {
    const previewId = `preview:${dedupeKey}`;
    const row = catalogRowFromStagingInsert(previewId, built.payload);
    registerNewProductInStagingCatalog(catalog, ncmBuckets, row);
    chunkProductDedupeByKey.set(dedupeKey, previewId);
    recordPreviewLine(preview.sink, preview.lineIndex, line, {
      action: "create_product",
      product_id: previewId,
      product_name: row.name,
      criterio: contexto,
      planned_product: plannedProductFromBuilt(previewId, built, contexto),
    });
    return {
      productId: previewId,
      stockApplied: applyStockOnCreate && stockQty > 0,
    };
  }

  if (applyStockOnCreate && stockQty <= 0) {
    console.error(
      LOG,
      "produto_skip_sem_movimentacao",
      JSON.stringify({
        motivo: "quantidade_entrada_invalida",
        nome: nomeProduto,
        quantidade: line.quantidade ?? null,
      }),
    );
    return { productId: null, stockApplied: false };
  }

  const inserted = await insertProductFromStagingInterpret(
    admin,
    companyId,
    built.payload,
    built.conversions,
    contexto,
    applyStockOnCreate
      ? { quantity: stockQty, unitValue: stockUnitValue }
      : null,
    supplierId,
  );
  if (!inserted.productId) return { productId: null, stockApplied: false };
  const newId = inserted.productId;
  console.log(
    LOG,
    inserted.stockApplied
      ? "produto_criado_com_estoque"
      : "produto_criado_sem_estoque",
    JSON.stringify({
      product_id: newId,
      nome: nomeProduto,
      unidade: built.payload.unit ?? null,
      quantidade_entrada: applyStockOnCreate ? stockQty : 0,
      valor_unitario: stockUnitValue,
      conversoes: built.conversions.length,
      pack_note: built.registrationNote,
      criterio: contexto,
      criterio_descricao: criterioProdutoCriadoLabel(contexto),
      stock_applied: inserted.stockApplied,
    }),
  );
  registerNewProductInStagingCatalog(
    catalog,
    ncmBuckets,
    catalogRowFromStagingInsert(newId, built.payload),
  );
  chunkProductDedupeByKey.set(dedupeKey, newId);
  return { productId: newId, stockApplied: inserted.stockApplied };
}

/** Localiza fornecedor da empresa pelo CPF/CNPJ da NF (já deve ter sido ensured antes). */
async function findSupplierIdForInterpret(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
): Promise<string | null> {
  const digits = normalizeTaxIdForSupplierDocument(
    interpret.fornecedor.documento,
  );
  if (!digits || (digits.length !== 11 && digits.length !== 14)) return null;

  const { data: rows, error } = await admin
    .from("suppliers")
    .select("id,document")
    .eq("company_id", companyId);
  if (error) {
    console.error(LOG, "fornecedor_lookup_err", error.message);
    return null;
  }
  const found = (Array.isArray(rows) ? rows : []).find(
    (r: { document: string | null }) =>
      normalizeTaxIdForSupplierDocument(r.document) === digits,
  );
  return found?.id != null ? String(found.id) : null;
}

async function upsertProductSupplierCode(
  admin: SupabaseAdmin,
  companyId: string,
  supplierId: string | null,
  cProd: string | null,
  productId: string,
  preview: boolean,
): Promise<void> {
  if (preview) return;
  await upsertProductSupplierCodeShared(
    admin,
    companyId,
    supplierId,
    cProd,
    productId,
  );
}

/**
 * 1) Fornecedor: localiza por CPF/CNPJ (só dígitos); se não existir, insere em `suppliers`.
 */
export async function ensureSupplierForInterpretLog(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
  previewSink?: StagingInterpretPreviewSink,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const digits = normalizeTaxIdForSupplierDocument(
    interpret.fornecedor.documento,
  );
  if (!digits || (digits.length !== 11 && digits.length !== 14)) {
    if (previewSink) {
      previewSink.supplier = {
        document_digits: digits || null,
        action: "invalid_document",
      };
    }
    return;
  }

  const { data: rows, error } = await admin
    .from("suppliers")
    .select("id,name,document,email,phone")
    .eq("company_id", companyId);

  if (error) {
    console.error(LOG, "fornecedor_list_err", error.message);
    if (previewSink) {
      previewSink.supplier = {
        document_digits: digits,
        action: "invalid_document",
      };
    }
    return;
  }

  const list = Array.isArray(rows) ? rows : [];
  const found = list.find(
    (r: { document: string | null; id?: string; name?: string }) =>
      normalizeTaxIdForSupplierDocument(r.document) === digits,
  );

  if (previewSink) {
    if (found) {
      previewSink.supplier = {
        document_digits: digits,
        action: "link_existing",
        existing_supplier_id: found.id != null ? String(found.id) : null,
        existing_supplier_name: found.name != null ? String(found.name) : null,
      };
    } else {
      previewSink.supplier = {
        document_digits: digits,
        action: "would_create",
        planned_insert: {
          name:
            (interpret.fornecedor.nome ?? "").trim() ||
            "Fornecedor (NF-e staging)",
          document: digits,
          notes: "Cadastrado automaticamente",
        },
      };
    }
    return;
  }

  if (found) return;

  const insertBody: Record<string, unknown> = {
    company_id: companyId,
    name:
      (interpret.fornecedor.nome ?? "").trim() || "Fornecedor (NF-e staging)",
    document: digits,
    notes: "Cadastrado automaticamente",
  };

  const { error: insErr } = await admin
    .from("suppliers")
    .insert(insertBody)
    .select("id")
    .single();
  if (insErr) {
    console.error(LOG, "fornecedor_insert_err", insErr.message);
  }
}

export type StagingInterpretProductCatalogRow = {
  id: string;
  name: string;
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  ean: string | null;
  barcode: string | null;
  unit: string | null;
  sku: string | null;
  canonical_name: string | null;
  merged_catalog_names: string[] | null;
  is_active: boolean | null;
};

/**
 * Catálogo de produtos da empresa (uma query por chunk / batch de interpretação).
 */
export async function fetchProductCatalogForStagingInterpret(
  admin: SupabaseAdmin,
  companyId: string,
): Promise<{
  catalog: StagingInterpretProductCatalogRow[];
  error: string | null;
}> {
  const { data: allProducts, error: listErr } = await admin
    .from("products")
    .select(
      "id,name,ncm,cfop,csosn,ean,barcode,unit,sku,canonical_name,merged_catalog_names,is_active",
    )
    .eq("company_id", companyId)
    .limit(8000);

  if (listErr) {
    return { catalog: [], error: listErr.message };
  }

  const catalog: StagingInterpretProductCatalogRow[] = (
    Array.isArray(allProducts) ? allProducts : []
  ).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    ncm: r.ncm != null ? String(r.ncm) : null,
    cfop: r.cfop != null ? String(r.cfop) : null,
    csosn: r.csosn != null ? String(r.csosn) : null,
    ean: r.ean != null ? String(r.ean) : null,
    barcode: r.barcode != null ? String(r.barcode) : null,
    unit: r.unit != null ? String(r.unit) : null,
    sku: r.sku != null ? String(r.sku) : null,
    canonical_name: r.canonical_name != null
      ? String(r.canonical_name)
      : null,
    merged_catalog_names: Array.isArray(r.merged_catalog_names)
      ? (r.merged_catalog_names as string[])
      : null,
    is_active: r.is_active === false ? false : true,
  }));

  return { catalog, error: null };
}

export type ResolveProductsMatchMode = "legacy" | "supplier_certainty";

/**
 * 2) Produtos (determinístico): identificadores do XML → criar só se nenhum bater.
 * No onboarding, produto novo é criado com movimentação de entrada na mesma TX.
 * No steady (`applyStockOnCreate=false`), só cadastra o produto — stock no recebimento.
 * `stockAppliedByLineIndex` marca linhas cuja entrada já foi feita no create
 * (para `expense_items.stock_added = true` e não duplicar no finalize).
 *
 * `matchMode`:
 * - `legacy` — EAN/SKU/nome/NCM/histórico (preview e caminhos antigos)
 * - `supplier_certainty` — só cProd/EAN/SKU no escopo do fornecedor (pipeline NF-e)
 */
export async function resolveProductsForInterpretLog(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
  productCatalog: StagingInterpretProductCatalogRow[],
  productIdByLineIndex: Map<number, string>,
  chunkProductDedupeByKey: Map<string, string>,
  previewSink?: StagingInterpretPreviewSink,
  stockAppliedByLineIndex?: Set<number>,
  matchMode: ResolveProductsMatchMode = "legacy",
  applyStockOnCreate = true,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const isPreview = !!previewSink;
  const invoiceResolvedProductByDedupeKey = new Map<string, string>();
  const ncmBuckets = new Map<string, StagingInterpretProductCatalogRow[]>();
  for (const p of productCatalog) {
    if (p.is_active === false) continue;
    const n8 = normalizeNcm8(p.ncm);
    if (!n8) continue;
    const arr = ncmBuckets.get(n8) ?? [];
    arr.push(p);
    ncmBuckets.set(n8, arr);
  }

  const supplierId = await findSupplierIdForInterpret(
    admin,
    companyId,
    interpret,
  );
  // Preview também lê vínculos/histórico (só não grava product_supplier_codes).
  const supplierHints = await loadSupplierProductMatchHints(
    admin,
    companyId,
    supplierId,
  );

  for (let lineIndex = 0; lineIndex < interpret.produtos.length; lineIndex++) {
    const line = interpret.produtos[lineIndex]!;
    const dedupeKey = stagingLineProductDedupeKey(line);
    const cProd = normalizeCProd(line.codigo);

    const chunkReuseId = chunkProductDedupeByKey.get(dedupeKey);
    if (chunkReuseId) {
      productIdByLineIndex.set(lineIndex, chunkReuseId);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, chunkReuseId);
      if (previewSink) {
        recordPreviewLine(previewSink, lineIndex, line, {
          action: "reuse_chunk_dedupe",
          product_id: chunkReuseId,
          criterio: "dedupe_chunk",
        });
      }
      continue;
    }

    const invoiceReuseId = invoiceResolvedProductByDedupeKey.get(dedupeKey);
    if (invoiceReuseId) {
      productIdByLineIndex.set(lineIndex, invoiceReuseId);
      chunkProductDedupeByKey.set(dedupeKey, invoiceReuseId);
      if (previewSink) {
        recordPreviewLine(previewSink, lineIndex, line, {
          action: "reuse_chunk_dedupe",
          product_id: invoiceReuseId,
          criterio: "dedupe_nota",
        });
      }
      continue;
    }

    const lineIdentity = {
      nome: line.nome,
      codigo: line.codigo,
      ean: line.ean,
      ncm: line.ncm,
      unidade_comercial: line.unidade_comercial,
      unidade_tributavel: line.unidade_tributavel,
      quantidade_comercial: line.quantidade_comercial,
      quantidade_tributavel: line.quantidade_tributavel,
      quantidade: line.quantidade,
    };

    let matched: Awaited<
      ReturnType<typeof matchExistingProductFromNfeXmlLine>
    > = null;
    if (matchMode === "supplier_certainty") {
      const hit = await matchProductBySupplierCertainty({
        supabase: admin,
        companyId,
        supplierId,
        supplierHints,
        catalog: productCatalog,
        line: lineIdentity,
      });
      matched = hit ? toLegacyMatchResult(hit) : null;
    } else {
      matched = await matchExistingProductFromNfeXmlLine({
        supabase: admin,
        companyId,
        supplierId,
        supplierHints,
        catalog: productCatalog,
        line: lineIdentity,
      });
    }

    if (matched) {
      productIdByLineIndex.set(lineIndex, matched.productId);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, matched.productId);
      chunkProductDedupeByKey.set(dedupeKey, matched.productId);
      supplierHints.preferredProductIds.add(matched.productId);
      for (const keyCandidate of [
        catalogMatchNameKeySafe(line.nome),
        catalogMatchNameKeySafe(matched.productName),
      ]) {
        if (keyCandidate) {
          supplierHints.nameKeyToProductId.set(keyCandidate, matched.productId);
        }
      }
      await upsertProductSupplierCode(
        admin,
        companyId,
        supplierId,
        cProd,
        matched.productId,
        isPreview,
      );
      if (previewSink) {
        recordPreviewLine(previewSink, lineIndex, line, {
          action: previewActionForMatchCriterio(matched.criterio),
          product_id: matched.productId,
          product_name: matched.productName,
          criterio: matched.criterio,
        });
      }
      continue;
    }

    const previewCtx = previewSink
      ? { sink: previewSink, lineIndex }
      : undefined;
    const built = productInsertPayload(companyId, line);
    if (!normalizeNcm8(line.ncm)) {
      // Ainda cria o produto; só registra aviso (NCM não bloqueia mais o cadastro).
      logProductSkipFiscalIncomplete(line, "ncm_ausente_criacao_mesmo_assim");
    }

    const created = await stagingInterpretCreateProduct(
      admin,
      companyId,
      productCatalog,
      ncmBuckets,
      chunkProductDedupeByKey,
      dedupeKey,
      built,
      "sem_identificador_existente",
      line,
      previewCtx,
      applyStockOnCreate,
      supplierId,
    );
    if (created.productId) {
      productIdByLineIndex.set(lineIndex, created.productId);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, created.productId);
      supplierHints.preferredProductIds.add(created.productId);
      const createdNameKey = catalogMatchNameKeySafe(
        String(built.payload.name ?? line.nome),
      );
      if (createdNameKey) {
        supplierHints.nameKeyToProductId.set(
          createdNameKey,
          created.productId,
        );
      }
      if (created.stockApplied) {
        stockAppliedByLineIndex?.add(lineIndex);
      }
      await upsertProductSupplierCode(
        admin,
        companyId,
        supplierId,
        cProd,
        created.productId,
        isPreview,
      );
    }
  }
}

function catalogMatchNameKeySafe(name: string | null | undefined): string | null {
  const key = catalogMatchNameKey(String(name ?? ""));
  return key.length >= 2 ? key : null;
}

function stagingReferenceDateYmd(interpret: StagingNfeInterpretLog): string {
  const d = interpret.data_emissao?.trim();
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * `document_total` gravado na despesa: com totais **ICMSTot** (`interpret.impostos`), usa **`vNF`**
 * do XML como valor oficial da nota. Caso contrário, usa `valor_total_nota` da interpretação ou a soma das linhas.
 */
function resolveStagingExpenseDocumentTotal(
  interpret: StagingNfeInterpretLog,
): {
  document_total: number | null;
  reconciliation_patch: Record<string, unknown>;
} {
  const produtos = interpret.produtos ?? [];
  const t = interpret.impostos;
  const sumProdutos = roundMoney(
    produtos.reduce((s, line) => {
      const v = Number(line.valor_total_linha);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0),
  );
  const vnf =
    t?.vNF != null && Number.isFinite(Number(t.vNF)) && Number(t.vNF) > 0
      ? roundMoney(Number(t.vNF))
      : null;

  const valorHeader =
    interpret.valor_total_nota != null &&
    Number.isFinite(Number(interpret.valor_total_nota))
      ? roundMoney(Number(interpret.valor_total_nota))
      : null;

  if (vnf != null) {
    let sumBonificacao = 0;
    for (const line of produtos) {
      if (isNfeBonificationCfop(line.cfop)) {
        const v = Number(line.valor_total_linha);
        if (Number.isFinite(v) && v > 0) sumBonificacao += v;
      }
    }
    const documentTotal =
      sumBonificacao > 0.000001 ? roundMoney(vnf - sumBonificacao) : vnf;

    const patch: Record<string, unknown> = {};
    if (sumBonificacao > 0.000001) {
      patch.document_total_excludes_bonification_5910 = true;
      patch.bonification_lines_total = roundMoney(sumBonificacao);
      patch.document_total_vnf_bruto = vnf;
    }
    if (valorHeader != null && Math.abs(valorHeader - documentTotal) > 0.02) {
      Object.assign(patch, {
        document_total_adjusted: true,
        document_total_before: valorHeader,
        document_total_after: documentTotal,
        document_total_source:
          sumBonificacao > 0.000001
            ? "icms_tot_vNF_minus_bonification_5910"
            : "icms_tot_vNF",
      });
    }
    return { document_total: documentTotal, reconciliation_patch: patch };
  }

  if (valorHeader != null) {
    return { document_total: valorHeader, reconciliation_patch: {} };
  }

  return {
    document_total: sumProdutos > 0 ? sumProdutos : null,
    reconciliation_patch: {},
  };
}

function extractedFromStagingInterpret(
  interpret: StagingNfeInterpretLog,
): ExtractedDocumentResult {
  return {
    validDocument: true,
    documentKind: "nota_fiscal",
    supplierName: interpret.fornecedor.nome,
    supplierDocument: interpret.fornecedor.documento,
    invoiceNumber: interpret.numero_nota,
    invoiceSeries: interpret.serie,
    nfeAccessKey: interpret.chave_nfe,
    emissionDate: interpret.data_emissao,
    totalAmount: interpret.valor_total_nota,
    items: [],
    notes: null,
    likelyNotEffectivePurchase: false,
    likelyNotPurchaseReason: null,
    businessIntent: "compra_insumos",
    dueDate: null,
    boletoTitle: null,
  };
}

/**
 * Garante `recebimentos` em status pendente (sem stock / sem marcar itens).
 */
async function ensurePendingRecebimento(
  admin: SupabaseAdmin,
  expenseId: string,
  companyId: string,
): Promise<string | null> {
  const { data: existingRec, error: selRecErr } = await admin
    .from("recebimentos")
    .select("id, status")
    .eq("expense_id", expenseId)
    .maybeSingle();
  if (selRecErr) {
    console.error(LOG, "recebimento_select_err", selRecErr.message);
    return null;
  }
  if (existingRec?.id != null) {
    return String(existingRec.id);
  }

  const { data: insRec, error: insRecErr } = await admin
    .from("recebimentos")
    .insert({
      company_id: companyId,
      expense_id: expenseId,
      status: "pending",
    })
    .select("id")
    .single();
  if (insRecErr) {
    const { data: again } = await admin
      .from("recebimentos")
      .select("id")
      .eq("expense_id", expenseId)
      .maybeSingle();
    if (again?.id != null) return String(again.id);
    console.error(LOG, "recebimento_insert_err", insRecErr.message);
    return null;
  }
  return insRec?.id != null ? String(insRec.id) : null;
}

/**
 * Garante `recebimentos`, aplica entrada de stock (`apply_xml_import_direct_stock_for_expense`)
 * e marca o card como recebido (onboarding / staging).
 */
async function finalizeStagingRecebimentoEStock(
  admin: SupabaseAdmin,
  expenseId: string,
  companyId: string,
): Promise<void> {
  let recebimentoId = await ensurePendingRecebimento(
    admin,
    expenseId,
    companyId,
  );

  if (!recebimentoId) {
    console.error(
      LOG,
      "recebimento_sem_id",
      JSON.stringify({ expense_id: expenseId }),
    );
    return;
  }

  const { data: stockRpc, error: stockRpcErr } = await admin.rpc(
    "apply_xml_import_direct_stock_for_expense",
    { p_expense_id: expenseId },
  );
  if (stockRpcErr) {
    console.error(LOG, "staging_apply_stock_rpc_err", stockRpcErr.message);
  } else if (
    stockRpc &&
    typeof stockRpc === "object" &&
    (stockRpc as { ok?: boolean }).ok === false
  ) {
    console.error(
      LOG,
      "staging_apply_stock_rpc_ok_false",
      JSON.stringify(stockRpc),
    );
  }

  const { data: eiRows, error: eiErr } = await admin
    .from("expense_items")
    .select("id, quantity, stock_quantity, product_id, stock_added")
    .eq("expense_id", expenseId);
  if (eiErr) {
    console.error(LOG, "recebimento_item_list_err", eiErr.message);
    return;
  }

  const statusRows: Record<string, unknown>[] = [];
  for (const ei of eiRows ?? []) {
    const pid = ei.product_id != null ? String(ei.product_id) : null;
    const q = Math.max(0, Number(ei.quantity) || 0);
    const sq = ei.stock_quantity != null ? Number(ei.stock_quantity) : q;
    const stk = ei.stock_added === true;
    const status = pid ? "received" : "not_received";
    const qtyRec = pid ? (stk ? sq : q) : 0;
    statusRows.push({
      company_id: companyId,
      recebimento_id: recebimentoId,
      expense_item_id: ei.id,
      status,
      quantity_received: qtyRec,
    });
  }

  if (statusRows.length > 0) {
    const { error: upsErr } = await admin
      .from("recebimento_item_status")
      .upsert(statusRows, {
        onConflict: "recebimento_id,expense_item_id",
      });
    if (upsErr) {
      console.error(LOG, "recebimento_item_status_upsert_err", upsErr.message);
    }
  }

  const { error: updRecErr } = await admin
    .from("recebimentos")
    .update({
      status: "received",
      received_at: new Date().toISOString(),
    })
    .eq("id", recebimentoId);
  if (updRecErr) {
    console.error(LOG, "recebimento_finalize_err", updRecErr.message);
  }
}

/**
 * 3) Persiste despesa (`expenses` + `expense_items`) e duplicatas de cobrança em `boletos` vinculadas à despesa.
 * Grava totais do bloco ICMSTot em `financial_reconciliation_json` para conferência (desconto, IPI, PIS, COFINS, etc.).
 * `document_total` na despesa usa **`vNF`** do ICMSTot quando existir; senão o total da interpretação ou a soma das linhas.
 * Evita duplicata por empresa + fornecedor + nº/série (índice único + RPC `expense_find_duplicate_by_supplier_document`).
 * Onboarding: recebimento concluído + stock. Steady: recebimento pendente (confirmação manual).
 */
export type PersistStagingExpenseOptions = {
  /**
   * true = onboarding Focus (recebimento `received` + stock).
   * false = fluxo contínuo (recebimento `pending`, sem stock automático).
   * Default true para compatibilidade com staging/preview legado.
   */
  finalizeRecebimentoAndStock?: boolean;
};

export async function persistStagingInterpretExpenseAndBoletos(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
  productIdByLineIndex: ReadonlyMap<number, string>,
  previewSink?: StagingInterpretPreviewSink,
  stockAppliedByLineIndex?: ReadonlySet<number>,
  options?: PersistStagingExpenseOptions,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const finalizeRecebimentoAndStock =
    options?.finalizeRecebimentoAndStock !== false;

  const produtos = interpret.produtos ?? [];
  if (produtos.length === 0) {
    if (previewSink) {
      previewSink.expense = {
        would_create: false,
        skip_reason: "sem_produtos",
        supplier_id_for_expense: null,
        supplier_created_for_expense: false,
        document_total: null,
        financial_reconciliation_json: {},
        planned_expense: null,
        planned_items: [],
        would_finalize_recebimento_and_stock: false,
      };
    }
    return;
  }

  const numTrim =
    interpret.numero_nota != null ? String(interpret.numero_nota).trim() : "";
  const chaveLimpa = String(interpret.chave_nfe ?? "").replace(/\D/g, "");
  const invoiceNumber = numTrim || chaveLimpa;
  if (!invoiceNumber) return;

  const invoiceSeries =
    interpret.serie != null ? String(interpret.serie).trim() : "";

  const docDigits = normalizeTaxIdForSupplierDocument(
    interpret.fornecedor.documento,
  );
  const supplierDocDisplay =
    docDigits.length === 11 || docDigits.length === 14
      ? docDigits
      : (interpret.fornecedor.documento ?? "").trim() || null;

  let supplierId: string | null = null;
  let supplierCreatedForExpense = false;
  if (previewSink) {
    const taxDigits = normalizeTaxIdForSupplierDocument(
      interpret.fornecedor.documento,
    );
    if (taxDigits && (taxDigits.length === 11 || taxDigits.length === 14)) {
      const { data: supRows } = await admin
        .from("suppliers")
        .select("id")
        .eq("company_id", companyId);
      const found = (Array.isArray(supRows) ? supRows : []).find(
        (r: { document?: string | null; id?: string }) =>
          normalizeTaxIdForSupplierDocument(r.document) === taxDigits,
      );
      if (found?.id) {
        supplierId = String(found.id);
      } else {
        supplierCreatedForExpense = true;
        supplierId =
          previewSink.supplier?.action === "link_existing" &&
          previewSink.supplier.existing_supplier_id
            ? String(previewSink.supplier.existing_supplier_id)
            : "preview:supplier_new";
      }
    }
  } else {
    const ensured = await ensureSupplierFromExtracted(
      admin,
      companyId,
      extractedFromStagingInterpret(interpret),
      "Cadastrado automaticamente — importação NF-e staging",
    );
    supplierId = ensured.supplierId;
    supplierCreatedForExpense = ensured.createdNew;
  }

  const dupSupplierId =
    supplierId === "preview:supplier_new" ? null : supplierId;

  const { data: dupRow, error: dupErr } = await admin.rpc(
    "expense_find_duplicate_by_supplier_document",
    {
      p_company_id: companyId,
      p_supplier_id: dupSupplierId,
      p_supplier_document: supplierDocDisplay ?? "",
      p_invoice_number: invoiceNumber,
      p_invoice_series: invoiceSeries,
      p_exclude_expense_id: null,
    },
  );

  const supplierName =
    (interpret.fornecedor.nome ?? "").trim() || "Fornecedor (NF-e staging)";
  const notes =
    "Importado automaticamente" +
    (interpret.chave_nfe ? ` — \nChave NF-e: ${interpret.chave_nfe}` : "");

  const { document_total: documentTotalResolved, reconciliation_patch } =
    resolveStagingExpenseDocumentTotal(interpret);

  const financialReconciliation: Record<string, unknown> = {
    schema_version: 1,
    source: "focus_get_sync_nfe_interpret_staging",
    chave_nfe: interpret.chave_nfe,
    staging_id: interpret.staging_id ?? null,
    /** Totais do XML (`total/ICMSTot`): bases, ICMS, ST, desconto, frete, IPI, PIS, COFINS, vNF, etc. */
    icms_tot: interpret.impostos ?? null,
    valor_total_nota: interpret.valor_total_nota,
  };
  if (Object.keys(reconciliation_patch).length > 0) {
    Object.assign(financialReconciliation, reconciliation_patch);
  }

  const expenseRow: Record<string, unknown> = {
    company_id: companyId,
    created_by: null,
    type: "nota_fiscal",
    invoice_number: invoiceNumber,
    invoice_series: invoiceSeries || null,
    supplier_id: supplierId,
    supplier_document: supplierDocDisplay,
    supplier_name: supplierName,
    status: "pending",
    notes,
    expense_source: "manual",
    source_document_path: null,
    document_total: documentTotalResolved,
    divergence_reason: null,
    reference_date: stagingReferenceDateYmd(interpret),
    financial_reconciliation_json: financialReconciliation,
  };

  const defaultCategoryByProductId =
    await fetchProductDefaultExpenseCategoryById(
      admin,
      companyId,
      [...productIdByLineIndex.values()],
    );
  const ncmCategoryByNcm = await fetchCompanyNcmCategoryMap(admin, companyId);

  const itemRows = produtos.map((line, i) => {
    const q = Math.max(0.0001, Number(line.quantidade) || 0);
    const uv = Math.round((Number(line.valor_unitario) || 0) * 100) / 100;
    const pid = productIdByLineIndex.get(i);
    const ncmKey = ncmKeyForCategoryRule(line.ncm);
    const resolvedCat = resolvePurchaseCategoryId({
      productCategoryId: pid
        ? defaultCategoryByProductId.get(pid) ?? null
        : null,
      ncmCategoryId: ncmKey
        ? ncmCategoryByNcm.get(ncmKey)?.dreCategoryId ?? null
        : null,
    });
    const row: Record<string, unknown> = {
      company_id: companyId,
      expense_id: "preview:expense",
      product_name: (line.nome ?? "").trim() || "Item",
      quantity: q,
      unit_value: uv,
      product_id: pid ?? null,
      ncm: line.ncm ?? null,
    };
    if (resolvedCat) row.company_category_id = resolvedCat;
    if (pid) {
      row.stock_quantity = q;
      // Entrada já aplicada atomicamente no create do produto nesta linha.
      if (stockAppliedByLineIndex?.has(i)) {
        row.stock_added = true;
      }
    }
    const u =
      line.unidade_comercial != null
        ? String(line.unidade_comercial).trim()
        : "";
    if (u) row.invoice_unit = u;
    return row;
  });

  const dups = interpret.cobranca_boletos ?? [];
  const descBase =
    (interpret.numero_nota != null ? `NF ${interpret.numero_nota}` : "NF-e") +
    (interpret.serie != null ? ` série ${interpret.serie}` : "");

  const boletoRows = dups.map((dup) => ({
    company_id: companyId,
    expense_id: "preview:expense",
    description: `${descBase} — dup. ${dup.numero_duplicata ?? "?"}`,
    due_date: dup.vencimento,
    amount: dup.valor,
    payment_type: "boleto",
    status: "pending",
    provider: interpret.fornecedor.nome ?? null,
    category: "fornecedores",
    flow_type: "payable",
  }));

  if (previewSink) {
    const duplicateId =
      dupRow != null && String(dupRow).length > 0 ? String(dupRow) : null;
    previewSink.expense = {
      would_create: !duplicateId,
      skip_reason: duplicateId
        ? "despesa_duplicada"
        : dupErr
          ? `dup_check_err:${dupErr.message}`
          : undefined,
      duplicate_expense_id: duplicateId,
      supplier_id_for_expense: supplierId,
      supplier_created_for_expense: supplierCreatedForExpense,
      document_total: documentTotalResolved,
      financial_reconciliation_json: financialReconciliation,
      planned_expense: duplicateId ? null : expenseRow,
      planned_items: duplicateId ? [] : itemRows,
      would_finalize_recebimento_and_stock:
        !duplicateId && finalizeRecebimentoAndStock,
    };
    previewSink.boletos = duplicateId ? [] : boletoRows;
    return;
  }

  if (dupErr) {
    console.error(LOG, "despesa_dup_check_err", dupErr.message);
  } else if (dupRow != null && String(dupRow).length > 0) {
    return;
  }

  const { data: expenseIns, error: expErr } = await admin
    .from("expenses")
    .insert(expenseRow)
    .select("id")
    .single();

  if (expErr) {
    const msg = expErr.message ?? String(expErr);
    if (!msg.includes("duplicate") && !msg.includes("idx_expenses_unique")) {
      console.error(LOG, "despesa_insert_err", msg);
    }
    return;
  }

  const expenseId = expenseIns?.id as string | undefined;
  if (!expenseId) {
    console.error(
      LOG,
      "despesa_insert_sem_id",
      JSON.stringify({ chave_nfe: interpret.chave_nfe }),
    );
    return;
  }

  const persistedItemRows = itemRows.map((row) => ({
    ...row,
    expense_id: expenseId,
  }));

  const { error: itemsErr } = await admin
    .from("expense_items")
    .insert(persistedItemRows);
  if (itemsErr) {
    console.error(LOG, "despesa_itens_insert_err", itemsErr.message);
    await admin.from("expenses").delete().eq("id", expenseId);
    return;
  }

  for (const boletoRow of boletoRows.map((row) => ({
    ...row,
    expense_id: expenseId,
  }))) {
    const { error: bolErr } = await admin.from("boletos").insert(boletoRow);
    if (bolErr) {
      console.error(
        LOG,
        "boleto_insert_err",
        bolErr.message,
        JSON.stringify({ expense_id: expenseId }),
      );
    }
  }

  if (finalizeRecebimentoAndStock) {
    await finalizeStagingRecebimentoEStock(admin, expenseId, companyId);
  } else {
    const recebimentoId = await ensurePendingRecebimento(
      admin,
      expenseId,
      companyId,
    );
    if (!recebimentoId) {
      console.error(
        LOG,
        "recebimento_pendente_sem_id",
        JSON.stringify({ expense_id: expenseId }),
      );
    }
  }
}

/** Dry-run completo da interpretação staging (sem inserts). */
export async function buildStagingInterpretPreviewFromLog(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
): Promise<StagingInterpretPreviewResult> {
  const { catalog, error: catalogFetchErr } =
    await fetchProductCatalogForStagingInterpret(admin, companyId);

  const sink = createStagingInterpretPreviewSink(
    catalog.length,
    catalogFetchErr,
  );

  const productIdByLineIndex = new Map<number, string>();
  const chunkProductDedupeByKey = new Map<string, string>();
  const stockAppliedByLineIndex = new Set<number>();

  // Fornecedor primeiro: o match por cProd depende do supplier_id.
  await ensureSupplierForInterpretLog(admin, companyId, interpret, sink);
  await resolveProductsForInterpretLog(
    admin,
    companyId,
    interpret,
    catalog,
    productIdByLineIndex,
    chunkProductDedupeByKey,
    sink,
    stockAppliedByLineIndex,
  );

  await persistStagingInterpretExpenseAndBoletos(
    admin,
    companyId,
    interpret,
    productIdByLineIndex,
    sink,
    stockAppliedByLineIndex,
  );

  const products_by_line: StagingInterpretPreviewLine[] = [];
  for (let i = 0; i < interpret.produtos.length; i++) {
    const recorded = sink.lines[i];
    if (recorded) {
      products_by_line.push(recorded);
      continue;
    }
    const line = interpret.produtos[i]!;
    products_by_line.push({
      ...previewLineBase(i, line),
      action: "skip_fiscal_incomplete",
      product_id: productIdByLineIndex.get(i) ?? null,
      criterio: "linha_sem_decisao_registrada",
    });
  }

  return {
    supplier: sink.supplier ?? {
      document_digits: normalizeTaxIdForSupplierDocument(
        interpret.fornecedor.documento,
      ),
      action: "invalid_document",
    },
    products_by_line,
    expense: sink.expense ?? {
      would_create: false,
      skip_reason: "expense_preview_nao_gerada",
      supplier_id_for_expense: null,
      supplier_created_for_expense: false,
      document_total: null,
      financial_reconciliation_json: {},
      planned_expense: null,
      planned_items: [],
      would_finalize_recebimento_and_stock: false,
    },
    boletos: sink.boletos,
    meta: {
      catalog_size: sink.catalog_size,
      openai_configured: sink.openai_configured,
      catalog_fetch_error: sink.catalog_fetch_error,
      unified_catalog_note:
        "Catálogo global unified_supplier_* não é simulado no preview (só na interpretação real).",
    },
  };
}

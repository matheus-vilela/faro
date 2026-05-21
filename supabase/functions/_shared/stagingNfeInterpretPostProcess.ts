/**
 * Pós-processamento após `interpretStagingNfeXmlForLog`: fornecedor, produtos (EAN → NCM+LLM),
 * persistência de despesa + boletos (NF-e staging).
 * Inserções reais: `suppliers` (quando ausente), `products` (quando o match não encontra cadastro),
 * `expenses` / `expense_items` / `boletos` (duplicatas vinculadas à despesa).
 * O catálogo de produtos (`fetchProductCatalogForStagingInterpret`) deve ser obtido **uma vez por chunk**
 * na Edge e **mutado in-place** quando um produto é criado (`registerNewProductInStagingCatalog`), para que
 * notas seguintes no mesmo chunk reutilizem o cadastro. Por nota: `resolveProductsForInterpretLog`
 * (preenche mapa linha→`product_id`) e em seguida `persistStagingInterpretExpenseAndBoletos`.
 */
import {
  ensureSupplierFromExtracted,
  normalizeTaxIdForSupplierDocument,
} from "./expenseSupplierEnsure.ts";
import { isNfeBonificationCfop } from "./nfeCfopBonification.ts";
import type { ExtractedDocumentResult } from "./openaiExpense.ts";
import {
  buildNewProductCatalogFromNfeLine,
  insertProductUnitConversions,
} from "./productImport/buildPackUnitConversionsFromLabel.ts";
import {
  canonicalProductName,
  sanitizeCatalogProductName,
} from "./productImport/canonicalName.ts";
import {
  buildLlmCatalogForInvoiceLine,
  catalogMatchNameKey,
  catalogToLlmArbiterCandidates,
  findCatalogProductByNameKey,
  findCatalogProductByNormalizedName,
  findDirectMatchByNcmAndName,
} from "./productImport/llmCatalogCandidates.ts";
import type { NfeRagArbiterCandidate } from "./productImport/productMatchLlmAssist.ts";
import type { StagingNfeInterpretLog } from "./stagingNfeInterpretLog.ts";
import {
  assistStagingNfeLineStockNormalizeAndMatch,
  type StagingNfeLineStockMatchResult,
} from "./stagingNfeProductStockLlmAssist.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

const LOG = "[focus-get-sync-nfe-interpret-staging|post]";

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
  const cfop = String(line.cfop ?? "").replace(/\D/g, "").slice(0, 4);
  return cfop.length === 4 ? cfop : null;
}

function normalizeOptionalCsosn(
  line: StagingNfeInterpretLog["produtos"][number],
): string | null {
  const csosn = String(line.csosn ?? "").replace(/\D/g, "").slice(0, 4);
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

/** Dígitos do GTIN e algumas variantes comuns para bater com o cadastro. */
function eanLookupKeys(raw: string | null | undefined): string[] {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return [];
  const keys = new Set<string>([d]);
  if (d.length === 12) keys.add(`0${d}`);
  if (d.length === 13 && d.startsWith("0")) keys.add(d.slice(1));
  if (d.length === 8) keys.add(d.padStart(14, "0"));
  if (d.length === 14 && d.startsWith("0")) keys.add(d.replace(/^0+/, "") || d);
  return [...keys];
}

function stockEntradaPreviewFromLlm(
  line: StagingNfeInterpretLog["produtos"][number],
  arb: Extract<
    StagingNfeLineStockMatchResult,
    { kind: "LINK" } | { kind: "NEW_PRODUCT" }
  >,
): Record<string, unknown> {
  return {
    normalized_product_name: arb.normalized_product_name ?? null,
    stock_quantity: arb.stock_quantity,
    stock_unit_value: arb.stock_unit_value,
    qty_xml: line.quantidade,
    valor_unitario_xml: line.valor_unitario,
    valor_total_linha_xml: line.valor_total_linha,
    uses_packaging_from_description: arb.uses_packaging_from_description,
    stock_recalibrated_from_xml: arb.stock_recalibrated_from_xml,
    implied_line_total: arb.stock_quantity * arb.stock_unit_value,
  };
}

function productInsertPayload(
  companyId: string,
  line: StagingNfeInterpretLog["produtos"][number],
  suggestedName?: string,
  estoquePreview?: Record<string, unknown> | null,
): {
  payload: Record<string, unknown>;
  conversions: ReturnType<typeof buildNewProductCatalogFromNfeLine>["conversions"];
  registrationNote: string | null;
} | null {
  const fiscal = normalizeLineFiscalForProduct(line);
  if (!fiscal) return null;

  const catalog = buildNewProductCatalogFromNfeLine({
    productName: String(line.nome ?? "").trim() || "Item",
    invoiceUnitRaw: line.unidade_comercial,
    suggestedCatalogName: suggestedName,
    unitCommercial: line.unidade_comercial,
    unitTax: line.unidade_tributavel,
    quantityCommercial: line.quantidade_comercial ?? line.quantidade,
    quantityTax: line.quantidade_tributavel,
  });
  const name = catalog.catalogName.slice(0, 512) || "Produto (NF-e)";
  const unit = catalog.stockUnit.slice(0, 32) || "un";
  const eanDigits = line.ean != null ? String(line.ean).replace(/\D/g, "") : "";
  const base: Record<string, unknown> = {
    company_id: companyId,
    name,
    unit,
    ncm: fiscal.ncm,
    cfop: fiscal.cfop,
    csosn: fiscal.csosn,
    ean: eanDigits.length > 0 ? eanDigits : null,
    min_quantity: 0,
    current_quantity: 0,
  };
  if (estoquePreview && Object.keys(estoquePreview).length > 0) {
    base.estoque_entrada_preview = estoquePreview;
  }
  return { payload: base, conversions: catalog.conversions, registrationNote: catalog.registrationNote };
}

/** Colunas válidas em `products` (exclui preview JSON só para log). */
function productRowForDbInsert(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
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
  } = payload;
  const ncmStr = normalizeNcm8(ncm != null ? String(ncm) : null);
  if (!ncmStr) return null;
  const cfopRaw =
    cfop != null ? String(cfop).replace(/\D/g, "").slice(0, 4) : "";
  const csosnRaw =
    csosn != null ? String(csosn).replace(/\D/g, "").slice(0, 4) : "";
  const cn = canonicalProductName(String(name ?? ""));
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
  };
}

async function insertProductFromStagingInterpret(
  admin: SupabaseAdmin,
  companyId: string,
  payload: Record<string, unknown>,
  conversions: ReturnType<typeof buildNewProductCatalogFromNfeLine>["conversions"],
  contexto: string,
): Promise<string | null> {
  const row = productRowForDbInsert(payload);
  if (!row) {
    console.error(
      LOG,
      "produto_insert_rejeitado",
      contexto,
      "ncm_obrigatorio",
      JSON.stringify({
        ncm: payload.ncm ?? null,
        cfop: payload.cfop ?? null,
        csosn: payload.csosn ?? null,
      }),
    );
    return null;
  }
  const { data, error } = await admin
    .from("products")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.error(LOG, "produto_insert_err", contexto, error.message);
    return null;
  }
  const newId = data?.id != null ? String(data.id) : null;
  if (newId && conversions.length > 0) {
    await insertProductUnitConversions(
      admin,
      companyId,
      newId,
      conversions,
      LOG,
    );
  }
  return newId;
}

const CRITERIO_PRODUTO_CRIADO: Record<string, string> = {
  sem_candidatos_ncm:
    "NCM na linha sem nenhum produto no cadastro com o mesmo NCM",
  sem_openai:
    "existem candidatos com o mesmo NCM mas OPENAI_API_KEY não configurada",
  llm_new_product:
    "OpenAI (árbitro por NCM) classificou como produto novo (NEW_PRODUCT)",
};

function criterioProdutoCriadoLabel(contexto: string): string {
  return CRITERIO_PRODUTO_CRIADO[contexto] ?? contexto;
}

/** Nome normalizado para dedupe e match de catálogo (sem_ncm). */
function stagingLineCatalogNameKey(
  line: StagingNfeInterpretLog["produtos"][number],
): string {
  return catalogMatchNameKey(String(line.nome ?? "").trim());
}

/** Chave estável (NCM + EAN + nome): reuso no chunk e na mesma NF sem novo insert. */
function stagingLineProductDedupeKey(
  line: StagingNfeInterpretLog["produtos"][number],
): string {
  const n8 = normalizeNcm8(line.ncm) ?? "_";
  const ean = String(line.ean ?? "").replace(/\D/g, "") || "_";
  const nome = stagingLineCatalogNameKey(line);
  return `${n8}\x1f${ean}\x1f${nome}`;
}

/**
 * Produto já cadastrado sem NCM válido (8 dígitos) e mesmo nome sanitizado.
 * Cobre notas/chunks seguintes: o 1º passe só faz match por EAN.
 */
function findCatalogProductSemNcmByName(
  catalog: StagingInterpretProductCatalogRow[],
  line: StagingNfeInterpretLog["produtos"][number],
): StagingInterpretProductCatalogRow | undefined {
  const lineKey = stagingLineCatalogNameKey(line);
  if (!lineKey) return undefined;
  return catalog.find((p) => {
    if (normalizeNcm8(p.ncm)) return false;
    return catalogMatchNameKey(p.name) === lineKey;
  });
}

function catalogRowFromStagingInsert(
  id: string,
  payload: Record<string, unknown>,
): StagingInterpretProductCatalogRow {
  const eanDigits =
    payload.ean != null ? String(payload.ean).replace(/\D/g, "") : "";
  return {
    id,
    name: String(payload.name ?? ""),
    ncm: payload.ncm != null ? String(payload.ncm).trim() || null : null,
    cfop: payload.cfop != null ? String(payload.cfop).trim() || null : null,
    csosn: payload.csosn != null ? String(payload.csosn).trim() || null : null,
    ean: eanDigits.length > 0 ? eanDigits : null,
    unit: payload.unit != null ? String(payload.unit).trim() || null : null,
    sku: null,
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
): Promise<string | null> {
  if (!built) return null;
  const nomeProduto = String(built.payload.name ?? "").trim() || "—";

  const existingInCatalog = findCatalogProductByNameKey(catalog, nomeProduto);
  if (existingInCatalog) {
    chunkProductDedupeByKey.set(dedupeKey, existingInCatalog.id);
    console.log(
      LOG,
      "produto_reutilizado_por_nome",
      JSON.stringify({
        product_id: existingInCatalog.id,
        nome: nomeProduto,
        criterio: contexto,
      }),
    );
    return existingInCatalog.id;
  }

  const cn = canonicalProductName(nomeProduto);
  if (cn.length >= 2) {
    const { data: dup } = await admin
      .from("products")
      .select("id, name, ncm, cfop, csosn, ean, unit")
      .eq("company_id", companyId)
      .eq("canonical_name", cn)
      .eq("is_active", true)
      .maybeSingle();
    if (dup?.id) {
      const row = catalogRowFromStagingInsert(String(dup.id), {
        name: String(dup.name ?? nomeProduto),
        ncm: dup.ncm,
        cfop: dup.cfop,
        csosn: dup.csosn,
        ean: dup.ean,
        unit: dup.unit,
      });
      registerNewProductInStagingCatalog(catalog, ncmBuckets, row);
      chunkProductDedupeByKey.set(dedupeKey, row.id);
      console.log(
        LOG,
        "produto_reutilizado_por_canonical_name",
        JSON.stringify({ product_id: row.id, canonical_name: cn, criterio: contexto }),
      );
      return row.id;
    }
  }

  const newId = await insertProductFromStagingInterpret(
    admin,
    companyId,
    built.payload,
    built.conversions,
    contexto,
  );
  if (!newId) return null;
  console.log(
    LOG,
    "produto_criado",
    JSON.stringify({
      product_id: newId,
      nome: nomeProduto,
      unidade: built.payload.unit ?? null,
      conversoes: built.conversions.length,
      pack_note: built.registrationNote,
      criterio: contexto,
      criterio_descricao: criterioProdutoCriadoLabel(contexto),
    }),
  );
  registerNewProductInStagingCatalog(
    catalog,
    ncmBuckets,
    catalogRowFromStagingInsert(newId, built.payload),
  );
  chunkProductDedupeByKey.set(dedupeKey, newId);
  return newId;
}

/**
 * 1) Fornecedor: localiza por CPF/CNPJ (só dígitos); se não existir, insere em `suppliers`.
 */
export async function ensureSupplierForInterpretLog(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const digits = normalizeTaxIdForSupplierDocument(
    interpret.fornecedor.documento,
  );
  if (!digits || (digits.length !== 11 && digits.length !== 14)) return;

  const { data: rows, error } = await admin
    .from("suppliers")
    .select("id,name,document,email,phone")
    .eq("company_id", companyId);

  if (error) {
    console.error(LOG, "fornecedor_list_err", error.message);
    return;
  }

  const list = Array.isArray(rows) ? rows : [];
  const found = list.find(
    (r: { document: string | null }) =>
      normalizeTaxIdForSupplierDocument(r.document) === digits,
  );

  if (found) return;

  const insertBody: Record<string, unknown> = {
    company_id: companyId,
    name:
      (interpret.fornecedor.nome ?? "").trim() || "Fornecedor (NF-e staging)",
    document: digits,
    notes: "Cadastrado automaticamente — focus-get-sync-nfe-interpret-staging",
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
  unit: string | null;
  sku: string | null;
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
    .select("id,name,ncm,cfop,csosn,ean,unit,sku,is_active")
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
    unit: r.unit != null ? String(r.unit) : null,
    sku: r.sku != null ? String(r.sku) : null,
    is_active: r.is_active === false ? false : true,
  }));

  return { catalog, error: null };
}

/**
 * 2) Produtos: EAN → match direto; senão lista por NCM + árbitro OpenAI (se `OPENAI_API_KEY`).
 * `productCatalog` vem de `fetchProductCatalogForStagingInterpret` (uma query por chunk) e é mutado
 * quando um produto novo é inserido. `chunkProductDedupeByKey` persiste entre notas do mesmo chunk.
 * Preenche `productIdByLineIndex` (índice da linha na NF → `products.id`) para vínculo nas `expense_items`.
 * Linhas repetidas (mesmo NCM/EAN/nome sanitizado) reutilizam o mesmo `product_id`
 * sem novo insert nem nova chamada LLM.
 */
export async function resolveProductsForInterpretLog(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
  productCatalog: StagingInterpretProductCatalogRow[],
  productIdByLineIndex: Map<number, string>,
  chunkProductDedupeByKey: Map<string, string>,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const openaiModel =
    (Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL") ?? "").trim() || "gpt-4o-mini";

  const activeCatalog = productCatalog.filter((p) => p.is_active !== false);
  const invoiceResolvedProductByDedupeKey = new Map<string, string>();

  const semMatchDireto: Array<{
    line: StagingNfeInterpretLog["produtos"][number];
    lineIndex: number;
  }> = [];

  for (let lineIndex = 0; lineIndex < interpret.produtos.length; lineIndex++) {
    const line = interpret.produtos[lineIndex]!;
    const dedupeKey = stagingLineProductDedupeKey(line);
    const chunkReuseId = chunkProductDedupeByKey.get(dedupeKey);
    if (chunkReuseId) {
      productIdByLineIndex.set(lineIndex, chunkReuseId);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, chunkReuseId);
      continue;
    }

    const keys = eanLookupKeys(line.ean);
    let hit: StagingInterpretProductCatalogRow | undefined;
    if (keys.length > 0) {
      hit = activeCatalog.find((p) => {
        const pe = p.ean != null ? String(p.ean).replace(/\D/g, "") : "";
        if (!pe) return false;
        return keys.includes(pe);
      });
    }

    if (hit) {
      productIdByLineIndex.set(lineIndex, hit.id);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, hit.id);
      chunkProductDedupeByKey.set(dedupeKey, hit.id);
      continue;
    }

    const byName = findCatalogProductByNameKey(
      activeCatalog,
      String(line.nome ?? "").trim(),
    );
    if (byName) {
      productIdByLineIndex.set(lineIndex, byName.id);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, byName.id);
      chunkProductDedupeByKey.set(dedupeKey, byName.id);
      continue;
    }

    semMatchDireto.push({ line, lineIndex });
  }

  const ncmBuckets = new Map<string, StagingInterpretProductCatalogRow[]>();
  for (const p of activeCatalog) {
    const n8 = normalizeNcm8(p.ncm);
    if (!n8) continue;
    const arr = ncmBuckets.get(n8) ?? [];
    arr.push(p);
    ncmBuckets.set(n8, arr);
  }

  for (const { line, lineIndex } of semMatchDireto) {
    const n8 = normalizeNcm8(line.ncm);
    const dedupeKey = stagingLineProductDedupeKey(line);
    const reuseId = invoiceResolvedProductByDedupeKey.get(dedupeKey);
    if (reuseId) {
      productIdByLineIndex.set(lineIndex, reuseId);
      continue;
    }

    const directNcmName = findDirectMatchByNcmAndName(
      activeCatalog,
      line.ncm,
      String(line.nome ?? ""),
    );
    if (directNcmName) {
      productIdByLineIndex.set(lineIndex, directNcmName.id);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, directNcmName.id);
      chunkProductDedupeByKey.set(dedupeKey, directNcmName.id);
      continue;
    }

    if (!n8) {
      const catalogHit = findCatalogProductSemNcmByName(activeCatalog, line);
      if (catalogHit) {
        productIdByLineIndex.set(lineIndex, catalogHit.id);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, catalogHit.id);
        chunkProductDedupeByKey.set(dedupeKey, catalogHit.id);
        continue;
      }
    }

    const llmCatalog = buildLlmCatalogForInvoiceLine(activeCatalog, line.ncm);

    if (!openaiKey || llmCatalog.length === 0) {
      const built = productInsertPayload(companyId, line);
      if (!built) {
        logProductSkipFiscalIncomplete(line, "ncm_ausente_ou_invalido");
        continue;
      }
      const newId = await stagingInterpretCreateProduct(
        admin,
        companyId,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        built,
        !openaiKey ? "sem_openai" : llmCatalog.length === 0 ? "sem_candidatos_ncm" : "sem_openai",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    const candidates = catalogToLlmArbiterCandidates(
      llmCatalog.map((c) => ({
        id: c.id,
        name: c.name,
        unit: c.unit,
        ncm: c.ncm,
        ean: c.ean,
      })),
    );

    const arb = await assistStagingNfeLineStockNormalizeAndMatch(
      openaiKey,
      openaiModel,
      { line, candidates },
    );

    if (arb.kind === "LINK") {
      const hit = activeCatalog.find((c) => c.id === arb.product_id);
      if (hit) {
        productIdByLineIndex.set(lineIndex, hit.id);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, hit.id);
        chunkProductDedupeByKey.set(dedupeKey, hit.id);
      }
      continue;
    }

    if (arb.kind === "NEW_PRODUCT") {
      const nomeCadastro =
        String(arb.normalized_product_name ?? "").trim().length > 0
          ? arb.normalized_product_name
          : arb.suggested_catalog_name;
      const existingByNorm = findCatalogProductByNormalizedName(
        activeCatalog,
        nomeCadastro,
      );
      if (existingByNorm) {
        console.log(
          LOG,
          "produto_vinculado_por_nome_normalizado",
          JSON.stringify({
            product_id: existingByNorm.id,
            nome_cadastro: nomeCadastro,
            nome_catalogo: existingByNorm.name,
            linha_nota: String(line.nome ?? "").trim(),
          }),
        );
        productIdByLineIndex.set(lineIndex, existingByNorm.id);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, existingByNorm.id);
        chunkProductDedupeByKey.set(dedupeKey, existingByNorm.id);
        continue;
      }
      const preview = stockEntradaPreviewFromLlm(line, arb);
      const built = productInsertPayload(companyId, line, nomeCadastro, preview);
      if (!built) {
        logProductSkipFiscalIncomplete(line, "ncm_ausente_ou_invalido");
        continue;
      }
      const newId = await stagingInterpretCreateProduct(
        admin,
        companyId,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        built,
        "llm_new_product",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    const built = productInsertPayload(companyId, line);
    if (!built) {
      logProductSkipFiscalIncomplete(line, "ncm_ausente_ou_invalido");
      continue;
    }
    const newId = await stagingInterpretCreateProduct(
      admin,
      companyId,
      productCatalog,
      ncmBuckets,
      chunkProductDedupeByKey,
      dedupeKey,
      built,
      "llm_skip_fallback",
    );
    if (newId) {
      productIdByLineIndex.set(lineIndex, newId);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
    }
  }
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
      sumBonificacao > 0.000001
        ? roundMoney(vnf - sumBonificacao)
        : vnf;

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
        document_total_source: sumBonificacao > 0.000001
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
 * Garante `recebimentos`, aplica entrada de stock (`apply_xml_import_direct_stock_for_expense`)
 * e marca o card como recebido (staging / service_role).
 */
async function finalizeStagingRecebimentoEStock(
  admin: SupabaseAdmin,
  expenseId: string,
  companyId: string,
): Promise<void> {
  let recebimentoId: string | null = null;
  const { data: existingRec, error: selRecErr } = await admin
    .from("recebimentos")
    .select("id")
    .eq("expense_id", expenseId)
    .maybeSingle();
  if (selRecErr) {
    console.error(LOG, "recebimento_select_err", selRecErr.message);
    return;
  }
  if (existingRec?.id != null) {
    recebimentoId = String(existingRec.id);
  } else {
    const { data: insRec, error: insRecErr } = await admin
      .from("recebimentos")
      .insert({ company_id: companyId, expense_id: expenseId })
      .select("id")
      .single();
    if (insRecErr) {
      const { data: again } = await admin
        .from("recebimentos")
        .select("id")
        .eq("expense_id", expenseId)
        .maybeSingle();
      if (again?.id != null) recebimentoId = String(again.id);
      else console.error(LOG, "recebimento_insert_err", insRecErr.message);
    } else if (insRec?.id != null) {
      recebimentoId = String(insRec.id);
    }
  }

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
 * Ao fim: recebimento como concluído + entrada de stock (`apply_xml_import_direct_stock_for_expense`).
 */
export async function persistStagingInterpretExpenseAndBoletos(
  admin: SupabaseAdmin,
  companyId: string,
  interpret: StagingNfeInterpretLog,
  productIdByLineIndex: ReadonlyMap<number, string>,
): Promise<void> {
  if (!interpret.parse_ok) return;

  const produtos = interpret.produtos ?? [];
  if (produtos.length === 0) return;

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

  const { supplierId } = await ensureSupplierFromExtracted(
    admin,
    companyId,
    extractedFromStagingInterpret(interpret),
    "Cadastrado automaticamente — importação NF-e staging (focus-get-sync-nfe-interpret-staging)",
  );

  const { data: dupRow, error: dupErr } = await admin.rpc(
    "expense_find_duplicate_by_supplier_document",
    {
      p_company_id: companyId,
      p_supplier_id: supplierId,
      p_supplier_document: supplierDocDisplay ?? "",
      p_invoice_number: invoiceNumber,
      p_invoice_series: invoiceSeries,
      p_exclude_expense_id: null,
    },
  );

  if (dupErr) {
    console.error(LOG, "despesa_dup_check_err", dupErr.message);
  } else if (dupRow != null && String(dupRow).length > 0) {
    return;
  }

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

  const itemRows = produtos.map((line, i) => {
    const q = Math.max(0.0001, Number(line.quantidade) || 0);
    const uv = Math.round((Number(line.valor_unitario) || 0) * 100) / 100;
    const pid = productIdByLineIndex.get(i);
    const row: Record<string, unknown> = {
      company_id: companyId,
      expense_id: expenseId,
      product_name: (line.nome ?? "").trim() || "Item",
      quantity: q,
      unit_value: uv,
      product_id: pid ?? null,
    };
    if (pid) {
      row.stock_quantity = q;
    }
    const u =
      line.unidade_comercial != null
        ? String(line.unidade_comercial).trim()
        : "";
    if (u) row.invoice_unit = u;
    return row;
  });

  const { error: itemsErr } = await admin
    .from("expense_items")
    .insert(itemRows);
  if (itemsErr) {
    console.error(LOG, "despesa_itens_insert_err", itemsErr.message);
    await admin.from("expenses").delete().eq("id", expenseId);
    return;
  }

  const dups = interpret.cobranca_boletos ?? [];
  const descBase =
    (interpret.numero_nota != null ? `NF ${interpret.numero_nota}` : "NF-e") +
    (interpret.serie != null ? ` série ${interpret.serie}` : "");

  for (const dup of dups) {
    const boletoRow: Record<string, unknown> = {
      company_id: companyId,
      expense_id: expenseId,
      description: `${descBase} — dup. ${dup.numero_duplicata ?? "?"}`,
      due_date: dup.vencimento,
      amount: dup.valor,
      payment_type: "boleto",
      status: "pending",
      provider: interpret.fornecedor.nome ?? null,
      category: "fornecedores",
      flow_type: "payable",
    };

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

  await finalizeStagingRecebimentoEStock(admin, expenseId, companyId);
}

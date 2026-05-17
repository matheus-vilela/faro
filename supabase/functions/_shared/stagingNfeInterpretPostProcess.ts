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
import type { ExtractedDocumentResult } from "./openaiExpense.ts";
import { sanitizeCatalogProductName } from "./productImport/canonicalName.ts";
import type { NfeRagArbiterCandidate } from "./productImport/productMatchLlmAssist.ts";
import type { StagingNfeInterpretLog } from "./stagingNfeInterpretLog.ts";
import {
  assistStagingNfeLineStockNormalizeAndMatch,
  type StagingNfeLineStockMatchResult,
} from "./stagingNfeProductStockLlmAssist.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

const LOG = "[focus-get-sync-nfe-interpret-staging|post]";

/** Log pedido: fornecedor/produto (comparação / preview). */
export type StagingEntityComparisonLog = {
  exist: boolean;
  dadosDoQueExiste: string;
  dadosDoQueEstaComparando: string;
  /** Corpo que seria enviado ao `insert` se fosse cadastrar; null se já existia ou não aplicável. */
  data: Record<string, unknown> | null;
};

function normalizeNcm8(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(0, 8);
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
): Record<string, unknown> {
  const nameRaw = (suggestedName ?? line.nome).trim();
  const name =
    sanitizeCatalogProductName(nameRaw).slice(0, 512) || "Produto (NF-e)";
  const unit = (line.unidade_comercial ?? "un").trim().slice(0, 32) || "un";
  const ncm = line.ncm != null ? String(line.ncm).trim() : null;
  const eanDigits = line.ean != null ? String(line.ean).replace(/\D/g, "") : "";
  const base: Record<string, unknown> = {
    company_id: companyId,
    name,
    unit,
    ncm: ncm && ncm.length > 0 ? ncm : null,
    ean: eanDigits.length > 0 ? eanDigits : null,
    min_quantity: 0,
    current_quantity: 0,
  };
  if (estoquePreview && Object.keys(estoquePreview).length > 0) {
    base.estoque_entrada_preview = estoquePreview;
  }
  return base;
}

/** Colunas válidas em `products` (exclui preview JSON só para log). */
function productRowForDbInsert(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { company_id, name, unit, ncm, ean, min_quantity, current_quantity } =
    payload;
  return {
    company_id,
    name,
    unit,
    ncm: ncm ?? null,
    ean: ean ?? null,
    min_quantity: min_quantity ?? 0,
    current_quantity: current_quantity ?? 0,
  };
}

async function insertProductFromStagingInterpret(
  admin: SupabaseAdmin,
  payload: Record<string, unknown>,
  contexto: string,
): Promise<string | null> {
  const row = productRowForDbInsert(payload);
  const { data, error } = await admin
    .from("products")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.error(LOG, "produto_insert_err", contexto, error.message);
    return null;
  }
  const id = data?.id != null ? String(data.id) : null;
  console.log(
    LOG,
    "produto_insert_ok",
    JSON.stringify({ contexto, name: row.name, id }),
  );
  return id;
}

function logComparison(
  kind: string,
  row: StagingEntityComparisonLog,
  extra?: unknown,
) {
  console.log(
    LOG,
    kind,
    JSON.stringify(extra != null ? { ...row, extra } : row, null, 2),
  );
}

/** Log enxuto por linha de produto (interpretação staging). */
function logProdutoComparacao(payload: {
  exist: boolean;
  dadosExiste: { name: string } | null;
  dadosComparado: { name: string };
  data: Record<string, unknown> | null;
}) {
  console.log(LOG, "produto_comparacao", JSON.stringify(payload));
}

function nomeLinhaProduto(
  line: StagingNfeInterpretLog["produtos"][number],
): string {
  return String(line.nome ?? "").trim() || "—";
}

/** Chave estável para a mesma nota: evita vários inserts quando a NF repete o mesmo item em linhas distintas. */
function stagingLineProductDedupeKey(
  line: StagingNfeInterpretLog["produtos"][number],
): string {
  const n8 = normalizeNcm8(line.ncm) ?? "_";
  const ean = String(line.ean ?? "").replace(/\D/g, "") || "_";
  const nome = sanitizeCatalogProductName(
    String(line.nome ?? "").trim(),
  ).toLowerCase();
  const unit =
    String(line.unidade_comercial ?? "")
      .trim()
      .toLowerCase() || "_";
  return `${n8}\x1f${ean}\x1f${nome}\x1f${unit}`;
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
  catalog: StagingInterpretProductCatalogRow[],
  ncmBuckets: Map<string, StagingInterpretProductCatalogRow[]>,
  chunkProductDedupeByKey: Map<string, string>,
  dedupeKey: string,
  payload: Record<string, unknown>,
  contexto: string,
): Promise<string | null> {
  const newId = await insertProductFromStagingInterpret(admin, payload, contexto);
  if (!newId) return null;
  registerNewProductInStagingCatalog(
    catalog,
    ncmBuckets,
    catalogRowFromStagingInsert(newId, payload),
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
  if (!interpret.parse_ok) {
    console.log(
      LOG,
      "fornecedor_skip",
      JSON.stringify({ motivo: "parse_ok_false" }),
    );
    return;
  }

  const digits = normalizeTaxIdForSupplierDocument(
    interpret.fornecedor.documento,
  );
  if (!digits || (digits.length !== 11 && digits.length !== 14)) {
    console.log(
      LOG,
      "fornecedor_skip",
      JSON.stringify({
        motivo: "documento_invalido",
        documento: interpret.fornecedor.documento,
      }),
    );
    return;
  }

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

  const comparando = JSON.stringify({
    nome: interpret.fornecedor.nome,
    documento: digits,
  });

  if (found) {
    const payload: StagingEntityComparisonLog = {
      exist: true,
      dadosDoQueExiste: JSON.stringify(found),
      dadosDoQueEstaComparando: comparando,
      data: null,
    };
    logComparison("fornecedor_comparacao", payload);
    return;
  }

  const insertBody: Record<string, unknown> = {
    company_id: companyId,
    name:
      (interpret.fornecedor.nome ?? "").trim() || "Fornecedor (NF-e staging)",
    document: digits,
    notes: "Cadastrado automaticamente — focus-get-sync-nfe-interpret-staging",
  };

  const payload: StagingEntityComparisonLog = {
    exist: false,
    dadosDoQueExiste: "(nenhum fornecedor com mesmo CPF/CNPJ)",
    dadosDoQueEstaComparando: comparando,
    data: insertBody,
  };
  logComparison("fornecedor_comparacao", payload);

  const { data: created, error: insErr } = await admin
    .from("suppliers")
    .insert(insertBody)
    .select("id")
    .single();
  if (insErr) {
    console.error(LOG, "fornecedor_insert_err", insErr.message);
  } else {
    console.log(
      LOG,
      "fornecedor_insert_ok",
      JSON.stringify({ id: created?.id }),
    );
  }
}

export type StagingInterpretProductCatalogRow = {
  id: string;
  name: string;
  ncm: string | null;
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
    .select("id,name,ncm,ean,unit,sku,is_active")
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
 * Linhas repetidas na mesma nota (mesmo NCM/EAN/nome sanitizado/unidade) reutilizam o mesmo `product_id`
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
  if (!interpret.parse_ok) {
    console.log(
      LOG,
      "produtos_skip",
      JSON.stringify({ motivo: "parse_ok_false" }),
    );
    return;
  }

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
      console.log(
        LOG,
        "produto_reuso_chunk",
        JSON.stringify({
          chave_nfe: interpret.chave_nfe,
          line_index: lineIndex,
          product_id: chunkReuseId,
        }),
      );
      logProdutoComparacao({
        exist: true,
        dadosExiste: { name: "chunk_item_ja_resolvido" },
        dadosComparado: { name: nomeLinhaProduto(line) },
        data: null,
      });
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
      logProdutoComparacao({
        exist: true,
        dadosExiste: { name: String(hit.name ?? "").trim() || "—" },
        dadosComparado: { name: nomeLinhaProduto(line) },
        data: null,
      });
      productIdByLineIndex.set(lineIndex, hit.id);
      invoiceResolvedProductByDedupeKey.set(dedupeKey, hit.id);
      chunkProductDedupeByKey.set(dedupeKey, hit.id);
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
    const nomeComparado = nomeLinhaProduto(line);
    const dedupeKey = stagingLineProductDedupeKey(line);
    const reuseId = invoiceResolvedProductByDedupeKey.get(dedupeKey);
    if (reuseId) {
      console.log(
        LOG,
        "produto_reuso_linha_duplicada_nota",
        JSON.stringify({
          chave_nfe: interpret.chave_nfe,
          line_index: lineIndex,
          product_id: reuseId,
        }),
      );
      logProdutoComparacao({
        exist: true,
        dadosExiste: { name: "mesma_nota_item_ja_resolvido" },
        dadosComparado: { name: nomeComparado },
        data: null,
      });
      productIdByLineIndex.set(lineIndex, reuseId);
      continue;
    }

    if (!n8) {
      const data = productInsertPayload(companyId, line);
      logProdutoComparacao({
        exist: false,
        dadosExiste: null,
        dadosComparado: { name: nomeComparado },
        data,
      });
      const newId = await stagingInterpretCreateProduct(
        admin,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        data,
        "sem_ncm",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    const candidatosNcm = ncmBuckets.get(n8) ?? [];

    if (candidatosNcm.length === 0) {
      const data = productInsertPayload(companyId, line);
      logProdutoComparacao({
        exist: false,
        dadosExiste: null,
        dadosComparado: { name: nomeComparado },
        data,
      });
      const newId = await stagingInterpretCreateProduct(
        admin,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        data,
        "sem_candidatos_ncm",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    if (!openaiKey) {
      const data = productInsertPayload(companyId, line);
      logProdutoComparacao({
        exist: false,
        dadosExiste: null,
        dadosComparado: { name: nomeComparado },
        data,
      });
      console.log(
        LOG,
        "produto_llm_skip_sem_openai",
        JSON.stringify({
          candidatos: candidatosNcm.length,
          model: openaiModel,
        }),
      );
      const newId = await stagingInterpretCreateProduct(
        admin,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        data,
        "sem_openai",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    const candidates: NfeRagArbiterCandidate[] = candidatosNcm.map(
      (c, idx) => ({
        rank: idx + 1,
        product_id: c.id,
        name: c.name,
        catalog_unit: c.unit,
        ncm: c.ncm,
        barcode_digits: c.ean != null ? String(c.ean).replace(/\D/g, "") : null,
        similarity_0_100: Math.max(40, 85 - idx * 3),
        match_detail: "candidato do cadastro com mesmo NCM (8 dígitos)",
      }),
    );

    const arb = await assistStagingNfeLineStockNormalizeAndMatch(
      openaiKey,
      openaiModel,
      {
        line,
        candidates,
      },
    );

    console.log(
      LOG,
      "produto_llm_resultado",
      JSON.stringify({ chave_nfe: interpret.chave_nfe, arb }),
    );

    if (arb.kind === "LINK") {
      const hit = candidatosNcm.find((c) => c.id === arb.product_id);
      logProdutoComparacao({
        exist: true,
        dadosExiste: {
          name: hit
            ? String(hit.name ?? "").trim() || "—"
            : `(id ${arb.product_id} não no pool NCM)`,
        },
        dadosComparado: { name: nomeComparado },
        data: null,
      });
      if (hit) {
        productIdByLineIndex.set(lineIndex, hit.id);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, hit.id);
        chunkProductDedupeByKey.set(dedupeKey, hit.id);
      }
      continue;
    }

    if (arb.kind === "NEW_PRODUCT") {
      const preview = stockEntradaPreviewFromLlm(line, arb);
      const nomeCadastro =
        String(arb.normalized_product_name ?? "").trim().length > 0
          ? arb.normalized_product_name
          : arb.suggested_catalog_name;
      const data = productInsertPayload(companyId, line, nomeCadastro, preview);
      logProdutoComparacao({
        exist: false,
        dadosExiste: null,
        dadosComparado: { name: nomeComparado },
        data,
      });
      const newId = await stagingInterpretCreateProduct(
        admin,
        productCatalog,
        ncmBuckets,
        chunkProductDedupeByKey,
        dedupeKey,
        data,
        "llm_new_product",
      );
      if (newId) {
        productIdByLineIndex.set(lineIndex, newId);
        invoiceResolvedProductByDedupeKey.set(dedupeKey, newId);
      }
      continue;
    }

    const data = productInsertPayload(companyId, line);
    logProdutoComparacao({
      exist: false,
      dadosExiste: null,
      dadosComparado: { name: nomeComparado },
      data,
    });
    console.log(
      LOG,
      "produto_sem_insert_automatico_llm",
      JSON.stringify({ chave_nfe: interpret.chave_nfe, insert_preview: data }),
    );
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
    const patch: Record<string, unknown> = {};
    if (valorHeader != null && Math.abs(valorHeader - vnf) > 0.02) {
      Object.assign(patch, {
        document_total_adjusted: true,
        document_total_before: valorHeader,
        document_total_after: vnf,
        document_total_source: "icms_tot_vNF",
      });
    }
    return { document_total: vnf, reconciliation_patch: patch };
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
      .insert({ expense_id: expenseId })
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
  } else {
    console.log(LOG, "staging_apply_stock_rpc", JSON.stringify(stockRpc));
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
  } else {
    console.log(
      LOG,
      "recebimento_concluido_staging",
      JSON.stringify({ expense_id: expenseId, recebimento_id: recebimentoId }),
    );
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
  if (!interpret.parse_ok) {
    console.log(
      LOG,
      "despesa_boletos_skip",
      JSON.stringify({ motivo: "parse_ok_false" }),
    );
    return;
  }

  const produtos = interpret.produtos ?? [];
  if (produtos.length === 0) {
    console.log(
      LOG,
      "despesa_skip",
      JSON.stringify({ motivo: "sem_itens", chave_nfe: interpret.chave_nfe }),
    );
    return;
  }

  const numTrim =
    interpret.numero_nota != null ? String(interpret.numero_nota).trim() : "";
  const chaveLimpa = String(interpret.chave_nfe ?? "").replace(/\D/g, "");
  const invoiceNumber = numTrim || chaveLimpa;
  if (!invoiceNumber) {
    console.log(
      LOG,
      "despesa_skip",
      JSON.stringify({ motivo: "sem_numero_nfe_e_sem_chave" }),
    );
    return;
  }

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
    console.log(
      LOG,
      "despesa_duplicada_skip",
      JSON.stringify({
        chave_nfe: interpret.chave_nfe,
        expense_id_existente: dupRow,
      }),
    );
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

  if (reconciliation_patch.document_total_adjusted === true) {
    console.log(
      LOG,
      "document_total_ajustado",
      JSON.stringify({
        chave_nfe: interpret.chave_nfe,
        antes: reconciliation_patch.document_total_before,
        depois: reconciliation_patch.document_total_after,
        diff_check:
          reconciliation_patch.reconcile_check_diff_sum_ipi_desc_minus_total,
      }),
    );
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
    if (msg.includes("duplicate") || msg.includes("idx_expenses_unique")) {
      console.log(
        LOG,
        "despesa_duplicada_insert",
        JSON.stringify({ chave_nfe: interpret.chave_nfe, erro: msg }),
      );
    } else {
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
    } else {
      console.log(
        LOG,
        "boleto_insert_ok",
        JSON.stringify({ expense_id: expenseId, due_date: dup.vencimento }),
      );
    }
  }

  await finalizeStagingRecebimentoEStock(admin, expenseId);

  if (dups.length === 0) {
    console.log(
      LOG,
      "despesa_ok_sem_boletos",
      JSON.stringify({ expense_id: expenseId, chave_nfe: interpret.chave_nfe }),
    );
  } else {
    console.log(
      LOG,
      "despesa_boletos_ok",
      JSON.stringify({
        expense_id: expenseId,
        chave_nfe: interpret.chave_nfe,
        boletos: dups.length,
      }),
    );
  }
}

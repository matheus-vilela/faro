/**
 * Laboratório / pré-visualização: interpretação de unidades e quantidade de estoque
 * por linha de NF-e via LLM, com confiança e validação numérica.
 * Unidade de cadastro e quantidade 1:1 vêm sempre da NF-e (mapeamento sistema + aliases da empresa).
 */

import {
  parsePackagingNameSlashPattern,
  stripPackSizeFromLabel,
} from "./packSizeFromLabel.ts";
import { mapInvoiceUnitToCatalogUnit } from "./invoiceUnitToCatalogUnit.ts";
import { applyCompanyUnitAlias } from "./unitNormalize.ts";

export type InvoiceLineUnitsAssistInput = {
  product_name: string;
  unit_commercial: string | null;
  unit_tax: string | null;
  quantity: number;
  unit_value: number;
  line_total: number;
  /** Unidade do produto sugerido/cadastro, se houver match (só contexto para a IA). */
  matched_catalog_unit: string | null;
  matched_product_name: string | null;
  /** Unidades distintas no catálogo — contexto para sugerir conversões; não define unidade principal. */
  catalog_units_distinct: string[];
  /**
   * Chaves `normalizeUnitAliasKey` → `unit_code` (tabela `company_custom_unit_aliases`).
   */
  company_unit_alias_norm_key_to_code?: Record<string, string>;
};

export type InvoiceLineUnitsAssistParsed = {
  cleaned_product_name: string;
  interpretation: string;
  /** Quantidade na unidade do cadastro (= quantidade da linha; 1:1 com a unidade da nota resolvida). */
  stock_quantity_suggested: number;
  /**
   * Fator: stock_quantity_suggested ≈ quantity × conversion_factor_per_invoice_unit
   * (sempre 1 para unidade alinhada à nota).
   */
  conversion_factor_per_invoice_unit: number;
  /** Código de unidade no cadastro, derivado da nota (+ alias empresa). */
  catalog_unit_target: string;
  /** Unidade comercial/tributável usada na resolução (texto da nota). */
  invoice_unit_raw: string | null;
  /** true se o código caiu no fallback (unidade não mapeada nas aliases fixas). */
  catalog_unit_needs_review: boolean;
  /** 0..1 — confiança principalmente no nome / interpretação. */
  confidence: number;
};

export type InvoiceLineUnitsAssistResult =
  | ({ kind: "OK" } & InvoiceLineUnitsAssistParsed)
  | { kind: "SKIP"; rationale: string }
  | { kind: "ERROR"; message: string };

/** Remove sufixo igual à unidade comercial/tributável da linha (evita «… PCT» no cadastro). Só unidades com ≥2 caracteres (evita cortar «L»/«G» ambíguos). */
function stripRedundantUnitSuffix(
  name: string,
  unitCommercial: string | null,
  unitTax: string | null,
): string {
  let s = name.trim();
  const units = [...new Set(
    [unitCommercial, unitTax]
      .filter(Boolean)
      .map((u) => String(u).trim())
      .filter((u) => u.length >= 2 && u.length <= 16),
  )];
  for (const u of units) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:\\s+|-)\\s*${esc}\\s*\\.?\\s*$`, "i");
    const next = s.replace(re, "").trim();
    if (next.length >= 2) s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

const SYSTEM = `És um especialista em NF-e de compra (Brasil) e gestão de stock.
Analisa UMA linha: descrição (xProd), unidades comerciais/tributáveis, quantidade, valor unitário e total.

Embalagens compostas no xProd (crítico):
- Padrão «N[sufixo]/massa» ou «N[sufixo]/volume» (ex.: 10B/400GR, 6X/500ML): o número antes da barra é a CONTAGEM de unidades INTERNAS por embalagem comercial; o trecho após a barra é peso ou volume POR essa unidade interna — NÃO é a unidade comercial da linha nem «só» esse peso como produto.
- A quantity da linha está sempre na unidade comercial da NF-e (unit_commercial / unit_tax, ex.: CX, FD, PCT). Na interpretation descreve a CADEIA: ex. «3 caixas × 10 bandejas de 400 g» (30 bandejas ou 12 kg no total), não «400 g» isolado.
- Se existir packaging_name_parse.detected=true no pedido, segue esses números como âncora; confirma coerência com quantity e unidade da linha.
- Não reduzas o significado do produto ao último segmento de massa quando houver contagem antes da barra.
- Padrão «CXn» ou «caixaN» colado no texto (ex.: CEBOLA NACIONAL CX4): o dígito n indica N caixas na descrição da embalagem; na interpretation liga à quantity e à unidade comercial da linha (ex.: 1 fardo com 4 caixas no nome).

Exemplo fixo: xProd «PAO ALHO TRD 10B/400GR», quantity=3, unit_commercial=CX → interpretation deve mencionar 3 caixas, 10 unidades internas (ex. bandejas) por caixa, 400 g por unidade interna — não «apenas 400 g».

Tarefas:
1) Propor nome limpo para cadastro: SEM códigos de unidade no texto (UN, UND, PCT, PAC, CX, FD, KG, G, GR, L, ML, etc.), SEM sufixos «- 5 kg», «(500g)», «40 UN». A unidade de medida do cadastro NÃO vem do modelo: o sistema define-a a partir da unidade da nota. Se a unidade da nota repetir no fim do nome, remove do nome limpo.
2) Na interpretação (texto curto): se xProd indicar conteúdo interno (ex.: N unidades por pacote, peso por embalagem), recomenda cadastrar conversão em product_unit_conversions entre a unidade da nota e a unidade interna — sem alterar a unidade principal do produto (que segue a nota).
3) Validar mentalmente se quantity × unit_value bate com line_total (tolerância ~1%); útil para confidence no nome.

O servidor IGNORA catalog_unit_target, stock_quantity_suggested e conversion_factor do modelo e preenche-os pela nota (1:1). Podes omitir esses três campos no JSON ou enviar placeholders.

catalog_units_distinct e match.catalog_unit são só contexto (ex.: sugerir conversão para uma unidade que a empresa já usa).

Responde SEMPRE um JSON único:
{
  "cleaned_product_name": "string",
  "interpretation": "string curta em pt",
  "confidence": number entre 0 e 1
}
Campos opcionais ignorados pelo servidor: "stock_quantity_suggested", "conversion_factor_per_invoice_unit", "catalog_unit_target".

Se não houver base suficiente para o nome, usa confidence <= 0.35 e cleaned_product_name o mais conservador possível (pode repetir xProd sem código de unidade no fim).
Nunca devolvam texto fora do JSON.`;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickInvoiceUnitRaw(
  unitCommercial: string | null,
  unitTax: string | null,
): string | null {
  const a = unitCommercial != null ? String(unitCommercial).trim() : "";
  if (a) return a;
  const b = unitTax != null ? String(unitTax).trim() : "";
  if (b) return b;
  return null;
}

/** Valida totais da linha e consistência stock ≈ q × fator. */
export function validateInvoiceLineUnitsNumeric(input: {
  quantity: number;
  unit_value: number;
  line_total: number;
  stock_quantity_suggested: number;
  conversion_factor_per_invoice_unit: number;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const q = input.quantity;
  const uv = input.unit_value;
  const lt = input.line_total;
  const stock = input.stock_quantity_suggested;
  const f = input.conversion_factor_per_invoice_unit;

  if (!(q > 0) || !Number.isFinite(uv) || !Number.isFinite(lt)) {
    reasons.push("quantidade/valores inválidos");
    return { ok: false, reasons };
  }

  const implied = q * uv;
  const tol = Math.max(0.02, Math.abs(lt) * 0.02);
  if (Number.isFinite(lt) && lt > 0 && Math.abs(implied - lt) > tol) {
    reasons.push(
      `total: q×vUn=${implied.toFixed(4)} vs vProd=${lt} (tol ${tol.toFixed(4)})`,
    );
  }

  if (!Number.isFinite(stock) || stock < 0) {
    reasons.push("stock sugerido inválido");
  }
  if (!Number.isFinite(f)) {
    reasons.push("fator inválido");
  }
  const stockFromFactor = q * f;
  const stol = Math.max(1e-4, Math.abs(stock) * 0.005);
  if (Number.isFinite(stock) && Number.isFinite(f) && Math.abs(stockFromFactor - stock) > stol) {
    reasons.push(
      `stock≠q×fator: ${stock} vs ${stockFromFactor.toFixed(6)}`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

export async function assistInvoiceLineUnits(
  apiKey: string,
  model: string,
  input: InvoiceLineUnitsAssistInput,
): Promise<InvoiceLineUnitsAssistResult> {
  if (!apiKey.trim()) {
    return { kind: "ERROR", message: "OPENAI_API_KEY ausente." };
  }

  const aliasMap = new Map(
    Object.entries(input.company_unit_alias_norm_key_to_code ?? {}).filter(
      ([k, v]) => k && String(v).trim(),
    ).map(([k, v]) => [k, String(v).trim()]),
  );

  const invoiceUnitRaw = pickInvoiceUnitRaw(
    input.unit_commercial,
    input.unit_tax,
  );
  const afterAlias =
    applyCompanyUnitAlias(invoiceUnitRaw, aliasMap) ?? invoiceUnitRaw ?? "";
  const mapped = mapInvoiceUnitToCatalogUnit(afterAlias || null);
  const catalogUnitTarget = mapped.unit.slice(0, 32);
  const stockQty = input.quantity;
  const factor = 1;

  const slashParse = parsePackagingNameSlashPattern(input.product_name);
  const packaging_name_parse = slashParse ?? { detected: false as const };

  const userPayload = {
    line: {
      product_name: input.product_name,
      unit_commercial: input.unit_commercial,
      unit_tax: input.unit_tax,
      quantity: input.quantity,
      unit_value: input.unit_value,
      line_total: input.line_total,
    },
    match: {
      catalog_unit: input.matched_catalog_unit,
      product_name: input.matched_product_name,
    },
    catalog_units_distinct: input.catalog_units_distinct,
    packaging_name_parse,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    return {
      kind: "ERROR",
      message: `OpenAI ${res.status}: ${txt.slice(0, 240)}`,
    };
  }

  const data = await res.json();
  const txt = String(data?.choices?.[0]?.message?.content ?? "").trim();
  try {
    const parsed = JSON.parse(txt) as Record<string, unknown>;
    let cleaned = String(parsed.cleaned_product_name ?? "").trim();
    const interpretation = String(parsed.interpretation ?? "").trim() || "—";
    const confidence = clamp01(Number(parsed.confidence));

    if (!cleaned) {
      cleaned = stripPackSizeFromLabel(input.product_name).trim();
    }
    if (!cleaned) {
      cleaned = String(input.product_name ?? "").trim() || "Item";
    }

    let nameForCadastro = stripPackSizeFromLabel(cleaned).trim();
    nameForCadastro = stripRedundantUnitSuffix(
      nameForCadastro,
      input.unit_commercial,
      input.unit_tax,
    );
    if (!nameForCadastro) nameForCadastro = cleaned.trim();

    return {
      kind: "OK",
      cleaned_product_name: nameForCadastro.slice(0, 512),
      interpretation: interpretation.slice(0, 800),
      stock_quantity_suggested: stockQty,
      conversion_factor_per_invoice_unit: factor,
      catalog_unit_target: catalogUnitTarget,
      invoice_unit_raw: invoiceUnitRaw,
      catalog_unit_needs_review: mapped.needsReview,
      confidence: Number.isFinite(confidence) ? confidence : 0.35,
    };
  } catch {
    return { kind: "ERROR", message: "JSON inválido do modelo." };
  }
}

export function lineUnitsWouldSubstituteStock(params: {
  confidence: number;
  autoConfidenceThreshold: number;
  numericOk: boolean;
}): boolean {
  return (
    params.confidence >= params.autoConfidenceThreshold &&
    params.numericOk
  );
}

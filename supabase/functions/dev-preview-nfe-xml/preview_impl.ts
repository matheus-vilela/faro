/**
 * Handler pesado (productMatch, parse XML, IA). Carregado via import() dinâmico
 * para o worker arrancar em OPTIONS sem avaliar este grafo (evita BOOT_ERROR).
 *
 * `previewLineDecision` em `_preview_line_simulation` é exclusivo do laboratório
 * dev-preview-nfe-xml (ver campo `scope: "dev_preview_only"`); não replica esse
 * payload na importação em lote até decisão explícita de produto.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { enrichExtractedWithTaxId } from "../_shared/expenseSupplierEnsure.ts";
import type { ExtractedDocumentResult } from "../_shared/openaiExpense.ts";
import {
  massPerCountUnitFromLabelKg,
  packSizeFromLabel,
  stripPackSizeFromLabel,
  volumePerCountUnitFromLabelLiters,
} from "../_shared/productImport/packSizeFromLabel.ts";
import { pickInvoiceUnitRaw } from "../_shared/productImport/consolidateItems.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import {
  resolveProductMatches,
  type ItemWithProductMatch,
} from "../received-whatsapp-message/productMatch.ts";
import {
  conversionFactorToA,
  normalizeUnitAliasKey,
  normalizeUnitLabel,
  unitsAreConvertible,
  unitsAreEqual,
  type NormalizedUnitCode,
} from "../_shared/productImport/unitNormalize.ts";
import {
  buildPreviewLineDecision,
  previewDefaultThresholds,
  type RecipeEvidence,
} from "./devPreviewDecision.ts";
import { corsHeaders } from "./cors.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const CATALOG_PREVIEW_LIMIT = 50;

function envLineUnitsAiMaxCalls(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_MAX_PER_PREVIEW") ?? "8";
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 40) : 8;
  } catch {
    return 8;
  }
}

function envLineUnitsAutoConfidenceThreshold(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_AUTO_CONFIDENCE_THRESHOLD") ?? "0.92";
    const n = Number.parseFloat(String(raw));
    if (!Number.isFinite(n)) return 0.92;
    return Math.max(0.5, Math.min(0.999, n));
  } catch {
    return 0.92;
  }
}

function envLineUnitsAiConcurrency(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_CONCURRENCY") ?? "4";
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return 4;
    return Math.min(n, 8);
  } catch {
    return 4;
  }
}

async function mapWithConcurrency<T, R>(
  arr: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(arr.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), arr.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= arr.length) break;
      ret[i] = await mapper(arr[i]!, i);
    }
  });
  await Promise.all(workers);
  return ret;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

type ConversionRow = {
  product_id: string;
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
};

type SuggestedConversion = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
  relation: string;
  derived_standard?: Array<{ unit_code: string; qty_for_1_un: number }>;
};

type EmbeddedMeasure = {
  value: number;
  unit: NormalizedUnitCode;
  source: "label_kg" | "label_l" | "regex";
};

type CompositePackMeasure = {
  outer_count: number;
  inner_value: number;
  inner_unit: NormalizedUnitCode;
  total_value_per_invoice_unit: number;
  source: "composite_regex";
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function normalizeUnitCodeForCatalog(raw: string): string {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "und") return "un";
  return t;
}

function normalizedToCatalogCode(u: NormalizedUnitCode): string | null {
  if (u === "UND") return "un";
  if (u === "MG") return "mg";
  if (u === "G") return "g";
  if (u === "KG") return "kg";
  if (u === "ML") return "ml";
  if (u === "L") return "l";
  return null;
}

function detectEmbeddedMeasure(rawName: string): EmbeddedMeasure | null {
  const kg = massPerCountUnitFromLabelKg(rawName);
  if (kg != null && kg > 0) {
    return { value: kg, unit: "KG", source: "label_kg" };
  }
  const liters = volumePerCountUnitFromLabelLiters(rawName);
  if (liters != null && liters > 0) {
    return { value: liters, unit: "L", source: "label_l" };
  }
  const re = /(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|l)\b/gi;
  let m: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(rawName)) !== null) last = m;
  if (!last) return null;
  const value = Number(String(last[1] ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const u = String(last[2] ?? "").toLowerCase();
  return {
    value,
    unit: u === "mg"
      ? "MG"
      : u === "g"
      ? "G"
      : u === "kg"
      ? "KG"
      : u === "ml"
      ? "ML"
      : "L",
    source: "regex",
  };
}

/**
 * Nota em UN (contagem) + medida por item no nome: preferir a unidade explícita do rótulo
 * (ex.: `750 ml` em vez de `0,75 L`) para sugestão de conversão, mantendo o mesmo valor físico.
 * Preserva `source` para não disparar o bloqueio por confiança da IA só por vir de regex.
 */
function preferEmbeddedMeasureForCountInvoice(
  rawName: string,
  e: EmbeddedMeasure,
): EmbeddedMeasure {
  const eps = 1e-6;
  if (e.unit === "L" && e.value > 0) {
    const re = /(\d+(?:[.,]\d+)?)\s*ml\b/gi;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawName)) !== null) last = m;
    if (last) {
      const mlVal = Number(String(last[1] ?? "").replace(",", "."));
      if (Number.isFinite(mlVal) && mlVal > 0) {
        const lFromMl = mlVal / 1000;
        if (Math.abs(lFromMl - e.value) <= eps) {
          return { value: round6(mlVal), unit: "ML", source: e.source };
        }
      }
    }
  }
  if (e.unit === "KG" && e.value > 0) {
    const re = /(\d+(?:[.,]\d+)?)\s*g\b/gi;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawName)) !== null) last = m;
    if (last) {
      const gVal = Number(String(last[1] ?? "").replace(",", "."));
      if (Number.isFinite(gVal) && gVal > 0) {
        const kgFromG = gVal / 1000;
        if (Math.abs(kgFromG - e.value) <= eps) {
          return { value: round6(gVal), unit: "G", source: e.source };
        }
      }
    }
  }
  return e;
}

function detectCompositePackMeasure(rawName: string): CompositePackMeasure | null {
  // Exemplos esperados: "10B/400g", "12x330ml", "6 un x 1L", "24 sache x 25g"
  const re =
    /(\d+(?:[.,]\d+)?)\s*(?:b|bdj|bandejas?|band|un|und|sache|saches?|pct|pacotes?)?\s*(?:x|\/)\s*(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|l)\b/i;
  const m = re.exec(String(rawName ?? ""));
  if (!m) return null;
  const outer = Number(String(m[1] ?? "").replace(",", "."));
  const inner = Number(String(m[2] ?? "").replace(",", "."));
  const unitRaw = String(m[3] ?? "").toLowerCase();
  if (!Number.isFinite(outer) || !Number.isFinite(inner) || outer <= 0 || inner <= 0) {
    return null;
  }
  const innerUnit: NormalizedUnitCode = unitRaw === "mg"
    ? "MG"
    : unitRaw === "g"
    ? "G"
    : unitRaw === "kg"
    ? "KG"
    : unitRaw === "ml"
    ? "ML"
    : "L";
  return {
    outer_count: round6(outer),
    inner_value: round6(inner),
    inner_unit: innerUnit,
    total_value_per_invoice_unit: round6(outer * inner),
    source: "composite_regex",
  };
}

function normalizeInvoiceCountableUnit(raw: string | null | undefined): string | null {
  const n = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!n) return null;
  if (["pct", "pacote", "pacotes", "pac"].includes(n)) return "pct";
  if (["cx", "caixa", "caixas"].includes(n)) return "cx";
  if (["fd", "fardo", "fardos"].includes(n)) return "fd";
  if (["sc", "saco", "sacos"].includes(n)) return "sc";
  if (["un", "und", "unidade", "unidades", "uni"].includes(n)) return "un";
  return null;
}

function buildDerivedStandardForOneUn(
  embedded: EmbeddedMeasure,
): Array<{ unit_code: string; qty_for_1_un: number }> {
  const familyTargets: NormalizedUnitCode[] = ["MG", "G", "KG", "ML", "L"];
  const out: Array<{ unit_code: string; qty_for_1_un: number }> = [];
  for (const t of familyTargets) {
    const f = conversionFactorToA(t, embedded.unit);
    if (f == null) continue;
    const code = normalizedToCatalogCode(t);
    if (!code) continue;
    out.push({ unit_code: code, qty_for_1_un: round6(embedded.value * f) });
  }
  return out;
}

function conversionAlreadyExists(
  rows: ConversionRow[],
  primaryCode: string,
  secondaryCode: string,
): boolean {
  const p = normalizeUnitCodeForCatalog(primaryCode);
  const s = normalizeUnitCodeForCatalog(secondaryCode);
  return rows.some((r) =>
    normalizeUnitCodeForCatalog(r.primary_unit_code) === p &&
    normalizeUnitCodeForCatalog(r.secondary_unit_code) === s
  );
}

/**
 * Cadastro existente com unidade principal diferente de UN: preserva unidade do produto
 * e sugere apenas conversões faltantes entre nota × cadastro.
 */
function suggestUnitStrategyExistingNonUn(params: {
  item: ItemWithProductMatch;
  existingProductUnit: string;
  existingConversions: ConversionRow[];
  catNorm: NormalizedUnitCode;
  stockQuantityFromMatch: number | null;
}): {
  primary_unit_code: string;
  source: "existing_product";
  embedded_measure: EmbeddedMeasure | null;
  suggested_conversions: SuggestedConversion[];
  suggested_stock_quantity_in_primary?: number;
  note: string;
} {
  const rawName = String(params.item.productName ?? "").trim();
  const invoiceUnitRaw = pickInvoiceUnitRaw(params.item);
  const invoiceUnitNormalized = invoiceUnitRaw
    ? normalizeUnitLabel(invoiceUnitRaw)
    : "UNKN";
  const invoiceUnitRawNorm = String(invoiceUnitRaw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const embedded = detectEmbeddedMeasure(rawName);
  const primaryLower = normalizeUnitCodeForCatalog(
    String(params.existingProductUnit).trim().toLowerCase(),
  );
  const q = Math.max(0, Number(params.item.quantity ?? 0));

  // Cadastro com unidade desconhecida (UNKN): ponte 1:1 para UN padronizada.
  if (params.catNorm === "UNKN") {
    const unknCode = primaryLower.trim() || "unkn";
    const suggested_conversions: SuggestedConversion[] = [];
    if (!conversionAlreadyExists(params.existingConversions, unknCode, "un")) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: unknCode,
        secondary_qty: 1,
        secondary_unit_code: "un",
        relation: `1 ${unknCode.toUpperCase()} = 1 UN`,
      });
    }
    const stockUnkn =
      params.stockQuantityFromMatch != null &&
      Number.isFinite(params.stockQuantityFromMatch)
        ? round6(params.stockQuantityFromMatch)
        : q;
    return {
      primary_unit_code: unknCode,
      source: "existing_product",
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: stockUnkn,
      note: suggested_conversions.length
        ? "Cadastro com unidade UNKN; sugerida conversão 1:1 para UN."
        : "Cadastro UNKN; ponte para UN já cadastrada.",
    };
  }

  if (
    invoiceUnitRawNorm === "mco" ||
    invoiceUnitRawNorm === "maco" ||
    invoiceUnitRawNorm === "maco(s)" ||
    invoiceUnitRawNorm === "maco." ||
    invoiceUnitRawNorm === "macoes"
  ) {
    const suggested_conversions: SuggestedConversion[] = [];
    if (
      primaryLower !== "mco" &&
      !conversionAlreadyExists(params.existingConversions, primaryLower, "mco")
    ) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: primaryLower,
        secondary_qty: 1,
        secondary_unit_code: "mco",
        relation: `1 ${primaryLower.toUpperCase()} = 1 MCO`,
      });
    }
    const stockM =
      params.stockQuantityFromMatch != null &&
      Number.isFinite(params.stockQuantityFromMatch)
        ? round6(params.stockQuantityFromMatch)
        : q;
    return {
      primary_unit_code: primaryLower,
      source: "existing_product",
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: stockM,
      note: suggested_conversions.length
        ? "Cadastro existente: ponte para maço sugerida."
        : "Cadastro existente; maço alinhado ao cadastro.",
    };
  }

  if (
    invoiceUnitNormalized !== "UNKN" &&
    unitsAreEqual(invoiceUnitNormalized, params.catNorm)
  ) {
    const stockEq =
      params.stockQuantityFromMatch != null &&
      Number.isFinite(params.stockQuantityFromMatch)
        ? round6(params.stockQuantityFromMatch)
        : q;
    return {
      primary_unit_code: primaryLower,
      source: "existing_product",
      embedded_measure: embedded,
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: stockEq,
      note: "Cadastro existente; unidade da nota igual à unidade principal.",
    };
  }

  if (
    invoiceUnitNormalized !== "UNKN" &&
    unitsAreConvertible(invoiceUnitNormalized, params.catNorm)
  ) {
    const priCode = normalizedToCatalogCode(params.catNorm);
    const secCode = normalizedToCatalogCode(invoiceUnitNormalized);
    const suggested_conversions: SuggestedConversion[] = [];
    if (priCode && secCode) {
      const secPerPrimary = conversionFactorToA(
        invoiceUnitNormalized,
        params.catNorm,
      );
      if (secPerPrimary != null && secPerPrimary > 0) {
        if (
          !conversionAlreadyExists(
            params.existingConversions,
            priCode,
            secCode,
          )
        ) {
          suggested_conversions.push({
            primary_qty: 1,
            primary_unit_code: priCode,
            secondary_qty: round6(secPerPrimary),
            secondary_unit_code: secCode,
            relation:
              `1 ${priCode.toUpperCase()} = ${round6(secPerPrimary)} ${secCode.toUpperCase()}`,
          });
        }
      }
    }
    let stockCv: number | undefined;
    if (
      params.stockQuantityFromMatch != null &&
      Number.isFinite(params.stockQuantityFromMatch)
    ) {
      stockCv = round6(params.stockQuantityFromMatch);
    } else {
      const f = conversionFactorToA(
        params.catNorm,
        invoiceUnitNormalized,
      );
      stockCv = f != null ? round6(q * f) : undefined;
    }
    return {
      primary_unit_code: primaryLower,
      source: "existing_product",
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: stockCv,
      note: suggested_conversions.length
        ? "Cadastro existente; conversão faltante entre unidade da nota e cadastro."
        : "Cadastro existente; conversão já cobre nota × cadastro.",
    };
  }

  const stockFb =
    params.stockQuantityFromMatch != null &&
    Number.isFinite(params.stockQuantityFromMatch)
      ? round6(params.stockQuantityFromMatch)
      : q;

  return {
    primary_unit_code: primaryLower,
    source: "existing_product",
    embedded_measure: embedded,
    suggested_conversions: [],
    suggested_stock_quantity_in_primary: stockFb,
    note:
      "Cadastro existente, mas unidade da nota não é automaticamente conversível com a principal; revisar manualmente.",
  };
}

function suggestUnitStrategy(params: {
  item: ItemWithProductMatch;
  existingProductUnit: string | null;
  existingConversions: ConversionRow[];
  aiConfidence: number | null;
  stockQuantityFromMatch: number | null;
}): {
  primary_unit_code: string;
  source: "existing_product" | "default_un";
  embedded_measure: EmbeddedMeasure | null;
  suggested_conversions: SuggestedConversion[];
  suggested_stock_quantity_in_primary?: number;
  note: string;
} {
  const existingUnitStr = params.existingProductUnit
    ? String(params.existingProductUnit).trim()
    : "";
  const hasExistingCatalog = existingUnitStr.length > 0;
  const source: "existing_product" | "default_un" = hasExistingCatalog
    ? "existing_product"
    : "default_un";

  if (hasExistingCatalog) {
    const catNorm = normalizeUnitLabel(existingUnitStr);
    if (catNorm !== "UND") {
      return suggestUnitStrategyExistingNonUn({
        item: params.item,
        existingProductUnit: existingUnitStr,
        existingConversions: params.existingConversions,
        catNorm,
        stockQuantityFromMatch: params.stockQuantityFromMatch,
      });
    }
  }

  const rawName = String(params.item.productName ?? "").trim();
  const invoiceUnitRaw = pickInvoiceUnitRaw(params.item);
  const invoiceUnitNormalized = invoiceUnitRaw
    ? normalizeUnitLabel(invoiceUnitRaw)
    : "UNKN";
  const invoiceUnitRawNorm = String(invoiceUnitRaw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const invoiceUnitCountable = normalizeInvoiceCountableUnit(invoiceUnitRaw);
  const composite = detectCompositePackMeasure(rawName);
  let embedded = detectEmbeddedMeasure(rawName);
  if (invoiceUnitNormalized === "UND" && embedded) {
    embedded = preferEmbeddedMeasureForCountInvoice(rawName, embedded);
  }
  const primary = "un";

  // Regra fixa pedida: MCO = maço, 1 UN = 1 MCO.
  if (
    invoiceUnitRawNorm === "mco" ||
    invoiceUnitRawNorm === "maco" ||
    invoiceUnitRawNorm === "maco(s)" ||
    invoiceUnitRawNorm === "maco." ||
    invoiceUnitRawNorm === "macoes"
  ) {
    const suggested_conversions: SuggestedConversion[] = [];
    if (!conversionAlreadyExists(params.existingConversions, "un", "mco")) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: "un",
        secondary_qty: 1,
        secondary_unit_code: "mco",
        relation: "1 UN = 1 MCO",
      });
    }
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note: suggested_conversions.length
        ? "Regra fixa de maço aplicada (1 UN = 1 MCO)."
        : "Regra fixa de maço já cadastrada para o produto.",
    };
  }

  // Regra fixa pedida: se nota vier em massa, 1 UN = 100 G.
  if (invoiceUnitNormalized === "KG" || invoiceUnitNormalized === "G" || invoiceUnitNormalized === "MG") {
    const fixedUnit = "g";
    const fixedQty = 100;
    const suggested_conversions: SuggestedConversion[] = [];
    if (!conversionAlreadyExists(params.existingConversions, "un", fixedUnit)) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: "un",
        secondary_qty: fixedQty,
        secondary_unit_code: fixedUnit,
        relation: "1 UN = 100 G",
        derived_standard: buildDerivedStandardForOneUn({
          value: fixedQty,
          unit: "G",
          source: "regex",
        }),
      });
    }
    const q = Math.max(0, Number(params.item.quantity ?? 0));
    const toG = conversionFactorToA("G", invoiceUnitNormalized);
    const gramsTotal = toG != null ? q * toG : null;
    const stockInUn = gramsTotal != null ? round6(gramsTotal / fixedQty) : undefined;
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: stockInUn,
      note: suggested_conversions.length
        ? "Regra fixa de massa aplicada (1 UN = 100 G)."
        : "Regra fixa de massa já cadastrada para o produto.",
    };
  }

  // Regra fixa pedida: se nota vier em volume, 1 UN = 100 ML.
  if (invoiceUnitNormalized === "L" || invoiceUnitNormalized === "ML") {
    const fixedUnit = "ml";
    const fixedQty = 100;
    const suggested_conversions: SuggestedConversion[] = [];
    if (!conversionAlreadyExists(params.existingConversions, "un", fixedUnit)) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: "un",
        secondary_qty: fixedQty,
        secondary_unit_code: fixedUnit,
        relation: "1 UN = 100 ML",
        derived_standard: buildDerivedStandardForOneUn({
          value: fixedQty,
          unit: "ML",
          source: "regex",
        }),
      });
    }
    const q = Math.max(0, Number(params.item.quantity ?? 0));
    const toMl = conversionFactorToA("ML", invoiceUnitNormalized);
    const mlTotal = toMl != null ? q * toMl : null;
    const stockInUn = mlTotal != null ? round6(mlTotal / fixedQty) : undefined;
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: stockInUn,
      note: suggested_conversions.length
        ? "Regra fixa de volume aplicada (1 UN = 100 ML)."
        : "Regra fixa de volume já cadastrada para o produto.",
    };
  }

  // Regra para embalagem composta no nome (ex.: 10B/400g).
  // Se detectar medida por item interno, converte total por unidade da nota e deriva UN (100 g/ml).
  if (composite && invoiceUnitCountable && invoiceUnitCountable !== "un") {
    const suggested_conversions: SuggestedConversion[] = [];
    const q = Math.max(0, Number(params.item.quantity ?? 0));
    if (composite.inner_unit === "MG" || composite.inner_unit === "G" || composite.inner_unit === "KG") {
      const toG = conversionFactorToA("G", composite.inner_unit);
      const gramsPerInvoiceUnit = toG != null
        ? round6(composite.total_value_per_invoice_unit * toG)
        : null;
      const unitsPerInvoiceUnit = gramsPerInvoiceUnit != null
        ? round6(gramsPerInvoiceUnit / 100)
        : null;
      if (unitsPerInvoiceUnit != null && unitsPerInvoiceUnit > 0) {
        if (!conversionAlreadyExists(params.existingConversions, "un", invoiceUnitCountable)) {
          suggested_conversions.push({
            primary_qty: unitsPerInvoiceUnit,
            primary_unit_code: "un",
            secondary_qty: 1,
            secondary_unit_code: invoiceUnitCountable,
            relation: `${unitsPerInvoiceUnit} UN = 1 ${invoiceUnitCountable.toUpperCase()}`,
            derived_standard: buildDerivedStandardForOneUn({
              value: 100,
              unit: "G",
              source: "regex",
            }),
          });
        }
        return {
          primary_unit_code: primary,
          source,
          embedded_measure: embedded,
          suggested_conversions,
          suggested_stock_quantity_in_primary: round6(q * unitsPerInvoiceUnit),
          note:
            `Embalagem composta detectada (${composite.outer_count} × ${composite.inner_value} ${composite.inner_unit}). ` +
            `Total por ${invoiceUnitCountable.toUpperCase()}: ${gramsPerInvoiceUnit} G; regra base 1 UN = 100 G aplicada.`,
        };
      }
    }
    if (composite.inner_unit === "ML" || composite.inner_unit === "L") {
      const toMl = conversionFactorToA("ML", composite.inner_unit);
      const mlPerInvoiceUnit = toMl != null
        ? round6(composite.total_value_per_invoice_unit * toMl)
        : null;
      const unitsPerInvoiceUnit = mlPerInvoiceUnit != null
        ? round6(mlPerInvoiceUnit / 100)
        : null;
      if (unitsPerInvoiceUnit != null && unitsPerInvoiceUnit > 0) {
        if (!conversionAlreadyExists(params.existingConversions, "un", invoiceUnitCountable)) {
          suggested_conversions.push({
            primary_qty: unitsPerInvoiceUnit,
            primary_unit_code: "un",
            secondary_qty: 1,
            secondary_unit_code: invoiceUnitCountable,
            relation: `${unitsPerInvoiceUnit} UN = 1 ${invoiceUnitCountable.toUpperCase()}`,
            derived_standard: buildDerivedStandardForOneUn({
              value: 100,
              unit: "ML",
              source: "regex",
            }),
          });
        }
        return {
          primary_unit_code: primary,
          source,
          embedded_measure: embedded,
          suggested_conversions,
          suggested_stock_quantity_in_primary: round6(q * unitsPerInvoiceUnit),
          note:
            `Embalagem composta detectada (${composite.outer_count} × ${composite.inner_value} ${composite.inner_unit}). ` +
            `Total por ${invoiceUnitCountable.toUpperCase()}: ${mlPerInvoiceUnit} ML; regra base 1 UN = 100 ML aplicada.`,
        };
      }
    }
  }

  // Regra de unidades contáveis: prioriza cadastro em UN com ponte 1:1
  // quando não houver exceção de massa/volume nem medida composta segura.
  if (invoiceUnitCountable && invoiceUnitCountable !== "un") {
    const suggested_conversions: SuggestedConversion[] = [];
    if (!conversionAlreadyExists(params.existingConversions, "un", invoiceUnitCountable)) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: "un",
        secondary_qty: 1,
        secondary_unit_code: invoiceUnitCountable,
        relation: `1 UN = 1 ${invoiceUnitCountable.toUpperCase()}`,
      });
    }
    // Se houver medida embutida segura no nome (ex.: "8kg"), também sugerir
    // a conversão do item unitário para massa/volume (ex.: 1 UN = 8 KG).
    if (embedded) {
      const embeddedCode = normalizedToCatalogCode(embedded.unit);
      if (
        embeddedCode &&
        !conversionAlreadyExists(params.existingConversions, "un", embeddedCode)
      ) {
        suggested_conversions.push({
          primary_qty: 1,
          primary_unit_code: "un",
          secondary_qty: round6(embedded.value),
          secondary_unit_code: embeddedCode,
          relation: `1 UN = ${round6(embedded.value)} ${embeddedCode.toUpperCase()}`,
          derived_standard: buildDerivedStandardForOneUn(embedded),
        });
      }
    }
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note:
        suggested_conversions.length > 1
          ? "Unidade contável da nota mapeada para UN (1:1) + conversão por medida embutida."
          : suggested_conversions.length === 1
          ? "Unidade contável da nota mapeada para UN com conversão 1:1."
          : "Unidade contável já convertida para UN no cadastro.",
    };
  }

  if (!embedded) {
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: null,
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note: "UN priorizada por padrão.",
    };
  }
  if (
    params.aiConfidence != null &&
    Number.isFinite(params.aiConfidence) &&
    params.aiConfidence < 0.7 &&
    embedded.source === "regex"
  ) {
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note:
        "Medida embutida detectada, mas confiança da IA baixa para converter automaticamente.",
    };
  }
  const embeddedCode = normalizedToCatalogCode(embedded.unit);
  if (!embeddedCode) {
    return {
      primary_unit_code: primary,
      source,
      embedded_measure: embedded,
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note: "Medida embutida sem mapeamento seguro para unidade de catálogo.",
    };
  }
  const suggested_conversions: SuggestedConversion[] = [];
  if (primary === "un") {
    if (!conversionAlreadyExists(params.existingConversions, "un", embeddedCode)) {
      suggested_conversions.push({
        primary_qty: 1,
        primary_unit_code: "un",
        secondary_qty: round6(embedded.value),
        secondary_unit_code: embeddedCode,
        relation: `1 UN = ${round6(embedded.value)} ${embeddedCode.toUpperCase()}`,
        derived_standard: buildDerivedStandardForOneUn(embedded),
      });
    }
    return {
      primary_unit_code: "un",
      source,
      embedded_measure: embedded,
      suggested_conversions,
      suggested_stock_quantity_in_primary: Number(params.item.quantity),
      note: suggested_conversions.length
        ? "UN priorizada com conversão por embalagem."
        : "UN priorizada; conversão já existe.",
    };
  }
  const factorToPrimary = conversionFactorToA(
    normalizeUnitLabel(primary),
    embedded.unit,
  );
  if (factorToPrimary != null) {
    const primaryQty = round6(embedded.value * factorToPrimary);
    if (
      primaryQty > 0 &&
      !conversionAlreadyExists(params.existingConversions, primary, "un")
    ) {
      suggested_conversions.push({
        primary_qty: primaryQty,
        primary_unit_code: primary,
        secondary_qty: 1,
        secondary_unit_code: "un",
        relation:
          `1 UN = ${round6(embedded.value)} ${embeddedCode.toUpperCase()} ` +
          `(= ${primaryQty} ${primary.toUpperCase()})`,
        derived_standard: buildDerivedStandardForOneUn(embedded),
      });
    }
  }
  return {
    primary_unit_code: primary,
    source,
    embedded_measure: embedded,
    suggested_conversions,
    suggested_stock_quantity_in_primary: Number(params.item.quantity),
    note: suggested_conversions.length
      ? "UN priorizada; conversão faltante sugerida."
      : "UN priorizada; sem conversão faltante segura.",
  };
}

function attachPreviewLineSimulation(
  items: ItemWithProductMatch[],
  params: {
    productUnitById: Map<string, string>;
    conversionsByProductId: Map<string, ConversionRow[]>;
    recipeEvidenceByProductId: Map<string, RecipeEvidence>;
    simulateImportBatch: boolean;
  },
) {
  const previewThresholds = previewDefaultThresholds();
  return items.map((it) => {
    const rawQty = Number(it.quantity);
    const lineTotal = Number(it.lineTotal);
    const { packFactor, rationale } = packSizeFromLabel(it.productName);
    const rawName = String(it.productName ?? "").trim() || "Item";
    const catalogNameForRegistration =
      stripPackSizeFromLabel(rawName).trim() || rawName;
    const massPerPackageKg = massPerCountUnitFromLabelKg(rawName);
    const impliedTotalMassKg =
      massPerPackageKg != null && massPerPackageKg > 0
        ? Math.round(rawQty * massPerPackageKg * 1e6) / 1e6
        : null;
    const factor =
      packFactor != null && packFactor >= 2 ? packFactor : null;
    const quantityAdjusted =
      factor != null
        ? Math.round(rawQty * factor * 1e6) / 1e6
        : Math.round(rawQty * 1e6) / 1e6;
    const unitValueAdjusted =
      quantityAdjusted > 0 && Number.isFinite(lineTotal)
        ? Math.round((lineTotal / quantityAdjusted) * 1e4) / 1e4
        : Number(it.unitValue);
    const pm = it.productMatch as Record<string, unknown> | undefined;
    const productId =
      pm?.resolvedProductId != null && String(pm.resolvedProductId).trim()
        ? String(pm.resolvedProductId).trim()
        : pm?.suggestedProductId != null && String(pm.suggestedProductId).trim()
        ? String(pm.suggestedProductId).trim()
        : null;
    const existingProductUnit = productId
      ? (params.productUnitById.get(productId) ?? null)
      : null;
    const existingConversions = productId
      ? (params.conversionsByProductId.get(productId) ?? [])
      : [];
    const ai = it._preview_line_ai_units as Record<string, unknown> | undefined;
    const aiConfidenceFromPreview =
      ai?.kind === "OK" && ai?.confidence != null
        ? Number(ai.confidence)
        : null;
    const matchScore =
      pm?.suggestedScore != null ? Number(pm.suggestedScore) / 100 : null;
    const aiConfidence = aiConfidenceFromPreview ?? matchScore;
    const stockQuantityFromMatch =
      pm?.stockQuantity != null && Number.isFinite(Number(pm.stockQuantity))
        ? Number(pm.stockQuantity)
        : null;
    const unitSuggestion = suggestUnitStrategy({
      item: it,
      existingProductUnit,
      existingConversions,
      aiConfidence,
      stockQuantityFromMatch,
    });
    const recipeEvidence = productId
      ? (params.recipeEvidenceByProductId.get(productId) ?? null)
      : null;
    const previewLineDecision = buildPreviewLineDecision({
      productName: rawName,
      quantityInvoice: rawQty,
      unitValueInvoice: Number(it.unitValue),
      lineTotal,
      productMatch: pm,
      unitSuggestion,
      existingConversions,
      recipeEvidence,
      thresholds: previewThresholds,
      simulateImportBatch: params.simulateImportBatch,
    });
    return {
      ...it,
      _preview_line_simulation: {
        packFactor: factor,
        packRationale: factor != null ? rationale : null,
        catalogNameForRegistration,
        massPerPackageKg,
        impliedTotalMassKg,
        rawQuantity: rawQty,
        quantityAdjusted,
        unitValueAdjusted,
        lineTotal: Number.isFinite(lineTotal) ? lineTotal : null,
        invoiceUnitRaw: pickInvoiceUnitRaw(it),
        unitSuggestion,
        previewLineDecision,
      },
    };
  });
}

type PreviewItem = Record<string, unknown> & {
  productMatch?: Record<string, unknown>;
};

async function attachLineUnitsAiPreview(
  items: PreviewItem[],
  params: {
    supabase: SupabaseClient;
    companyId: string;
    openaiKey: string;
    openaiModel: string;
  },
): Promise<{
  items: PreviewItem[];
  callsMade: number;
  maxPerPreview: number;
  autoThreshold: number;
  concurrency: number;
}> {
  const {
    assistInvoiceLineUnits,
    validateInvoiceLineUnitsNumeric,
    lineUnitsWouldSubstituteStock,
  } = await import("../_shared/productImport/invoiceLineUnitsLlmAssist.ts");

  async function processOneLineUnitsAi(
    it: PreviewItem,
    ctx: {
      openaiKey: string;
      openaiModel: string;
      catalogUnitsDistinct: string[];
      productUnitById: Map<string, string>;
      companyUnitAliasNormKeyToCode: Record<string, string>;
      autoThreshold: number;
    },
  ): Promise<PreviewItem> {
    const pm = it.productMatch as Record<string, unknown> | undefined;
    const suggestedName = pm?.suggestedProductName
      ? String(pm.suggestedProductName)
      : null;
    const sid = pm?.suggestedProductId
      ? String(pm.suggestedProductId)
      : null;
    const matchedUnit = sid ? (ctx.productUnitById.get(sid) ?? null) : null;

    const rawName = String(it.productName ?? "").trim() || "Item";
    const uCom = it.unitCommercial != null ? String(it.unitCommercial) : null;
    const uTrib = it.unitTax != null ? String(it.unitTax) : null;
    const qty = Number(it.quantity);
    const uv = Number(it.unitValue);
    const lt = Number(it.lineTotal);

    const assist = await assistInvoiceLineUnits(
      ctx.openaiKey,
      ctx.openaiModel,
      {
        product_name: rawName,
        unit_commercial: uCom,
        unit_tax: uTrib,
        quantity: qty,
        unit_value: uv,
        line_total: lt,
        matched_catalog_unit: matchedUnit,
        matched_product_name: suggestedName,
        catalog_units_distinct: ctx.catalogUnitsDistinct,
        company_unit_alias_norm_key_to_code: ctx.companyUnitAliasNormKeyToCode,
      },
    );

    if (assist.kind === "ERROR") {
      return {
        ...it,
        _preview_line_ai_units: {
          kind: "ERROR",
          message: assist.message,
          auto_confidence_threshold: ctx.autoThreshold,
        },
      };
    }
    if (assist.kind === "SKIP") {
      return {
        ...it,
        _preview_line_ai_units: {
          kind: "SKIP",
          rationale: assist.rationale,
          auto_confidence_threshold: ctx.autoThreshold,
        },
      };
    }

    const numeric = validateInvoiceLineUnitsNumeric({
      quantity: qty,
      unit_value: uv,
      line_total: lt,
      stock_quantity_suggested: assist.stock_quantity_suggested,
      conversion_factor_per_invoice_unit:
        assist.conversion_factor_per_invoice_unit,
    });

    const wouldSubstitute = lineUnitsWouldSubstituteStock({
      confidence: assist.confidence,
      autoConfidenceThreshold: ctx.autoThreshold,
      numericOk: numeric.ok,
    });

    return {
      ...it,
      _preview_line_ai_units: {
        kind: "OK",
        cleaned_product_name: assist.cleaned_product_name,
        interpretation: assist.interpretation,
        stock_quantity_suggested: assist.stock_quantity_suggested,
        conversion_factor_per_invoice_unit:
          assist.conversion_factor_per_invoice_unit,
        catalog_unit_target: assist.catalog_unit_target,
        invoice_unit_raw: assist.invoice_unit_raw,
        catalog_unit_needs_review: assist.catalog_unit_needs_review,
        confidence: assist.confidence,
        numeric_validation_ok: numeric.ok,
        numeric_validation_reasons: numeric.reasons,
        would_substitute_stock: wouldSubstitute,
        auto_confidence_threshold: ctx.autoThreshold,
      },
    };
  }

  const maxCalls = envLineUnitsAiMaxCalls();
  const autoThreshold = envLineUnitsAutoConfidenceThreshold();
  const concurrency = envLineUnitsAiConcurrency();

  const { data: unitRows } = await params.supabase
    .from("products")
    .select("unit")
    .eq("company_id", params.companyId)
    .eq("is_active", true)
    .not("unit", "is", null)
    .limit(800);

  const catalogUnitsDistinct = [
    ...new Set(
      (unitRows ?? []).map((r: { unit: string }) => String(r.unit ?? "").trim())
        .filter(Boolean),
    ),
  ].sort().slice(0, 48);

  const suggestedIds = [
    ...new Set(
      items
        .map((it) => {
          const sid = it.productMatch?.["suggestedProductId"];
          return sid != null ? String(sid).trim() : "";
        })
        .filter(Boolean),
    ),
  ];

  const productUnitById = new Map<string, string>();
  if (suggestedIds.length > 0) {
    const { data: prows } = await params.supabase
      .from("products")
      .select("id, unit")
      .eq("company_id", params.companyId)
      .in("id", suggestedIds);
    for (const r of (prows ?? []) as Array<{ id: string; unit: string | null }>) {
      if (r.unit) productUnitById.set(r.id, String(r.unit));
    }
  }

  const { data: companyUnitAliasRows, error: cuaErr } = await params.supabase
    .from("company_custom_unit_aliases")
    .select("unit_code, unit_label, source_hint")
    .eq("company_id", params.companyId);

  if (cuaErr) {
    console.warn(
      "[dev-preview-nfe-xml] company_custom_unit_aliases:",
      cuaErr.message,
    );
  }

  const companyUnitAliasNormKeyToCode: Record<string, string> = {};
  for (const row of (companyUnitAliasRows ?? []) as Array<{
    unit_code: string;
    unit_label: string;
    source_hint: string | null;
  }>) {
    const code = String(row.unit_code ?? "").trim();
    if (!code) continue;
    const kl = normalizeUnitAliasKey(row.unit_label);
    if (kl) companyUnitAliasNormKeyToCode[kl] = code;
    const kh = row.source_hint ? normalizeUnitAliasKey(row.source_hint) : "";
    if (kh) companyUnitAliasNormKeyToCode[kh] = code;
  }

  const ctx = {
    openaiKey: params.openaiKey,
    openaiModel: params.openaiModel,
    catalogUnitsDistinct,
    productUnitById,
    companyUnitAliasNormKeyToCode,
    autoThreshold,
  };

  const head = items.slice(0, maxCalls);
  const tail = items.slice(maxCalls);

  const processedHead = await mapWithConcurrency(
    head,
    concurrency,
    (it) => processOneLineUnitsAi(it, ctx),
  );

  const processedTail = tail.map((it) => ({
    ...it,
    _preview_line_ai_units: {
      skipped: true,
      reason: "Limite LINE_UNITS_AI_MAX_PER_PREVIEW atingido",
      auto_confidence_threshold: autoThreshold,
    },
  }));

  return {
    items: [...processedHead, ...processedTail],
    callsMade: head.length,
    maxPerPreview: maxCalls,
    autoThreshold,
    concurrency,
  };
}

async function enrichPreviewOnly(
  supabase: SupabaseClient,
  companyId: string,
  extracted: ExtractedDocumentResult,
  simulateImportBatch: boolean,
): Promise<{
  data: ExtractedDocumentResult & { _requiresProductConfirmation?: boolean };
  matchMeta: {
    deferProductCreationToReconciliation: boolean;
    borderlineLlmCalls: number;
    requiresProductConfirmation: boolean;
  } | null;
}> {
  const ex0 = enrichExtractedWithTaxId(extracted);
  const intent = ex0.businessIntent ?? "compra_insumos";
  if (intent === "conta_pagar" || intent === "conta_receber") {
    return {
      data: {
        ...ex0,
        items: ex0.items ?? [],
        _requiresProductConfirmation: false,
      },
      matchMeta: null,
    };
  }
  const matchOpts = simulateImportBatch ? { importBatch: true } : undefined;
  const matchResult = await resolveProductMatches(
    supabase,
    companyId,
    ex0.items ?? [],
    matchOpts,
  );
  const matchedProductIds = [
    ...new Set(
      (matchResult.items ?? []).map((it) => {
        const pm = it.productMatch as Record<string, unknown> | undefined;
        const resolved = pm?.resolvedProductId != null
          ? String(pm.resolvedProductId).trim()
          : "";
        const suggested = pm?.suggestedProductId != null
          ? String(pm.suggestedProductId).trim()
          : "";
        return resolved || suggested || "";
      }).filter(Boolean),
    ),
  ];
  const productUnitById = new Map<string, string>();
  const conversionsByProductId = new Map<string, ConversionRow[]>();
  if (matchedProductIds.length > 0) {
    const { data: pRows } = await supabase
      .from("products")
      .select("id, unit")
      .eq("company_id", companyId)
      .in("id", matchedProductIds);
    for (const row of (pRows ?? []) as Array<{ id: string; unit: string | null }>) {
      if (row.unit) productUnitById.set(String(row.id), String(row.unit));
    }
    const { data: cRows } = await supabase
      .from("product_unit_conversions")
      .select(
        "product_id, primary_qty, primary_unit_code, secondary_qty, secondary_unit_code",
      )
      .eq("company_id", companyId)
      .in("product_id", matchedProductIds);
    for (const row of (cRows ?? []) as ConversionRow[]) {
      const list = conversionsByProductId.get(row.product_id) ?? [];
      list.push(row);
      conversionsByProductId.set(row.product_id, list);
    }
  }

  const recipeEvidenceByProductId = new Map<string, RecipeEvidence>();
  if (matchedProductIds.length > 0) {
    const { data: outRec } = await supabase
      .from("recipes")
      .select("output_product_id")
      .eq("company_id", companyId)
      .eq("active", true)
      .in("output_product_id", matchedProductIds);
    const { data: ingRec } = await supabase
      .from("recipe_ingredients")
      .select("product_id")
      .in("product_id", matchedProductIds);
    const { data: opRec } = await supabase
      .from("product_operational_config")
      .select("product_id, linked_entry_breakdown_recipe_id")
      .eq("company_id", companyId)
      .in("product_id", matchedProductIds);

    const outSet = new Set(
      (outRec ?? [])
        .map((r: { output_product_id: string | null }) =>
          r.output_product_id ? String(r.output_product_id) : ""
        )
        .filter(Boolean),
    );
    const ingSet = new Set(
      (ingRec ?? []).map((r: { product_id: string }) => String(r.product_id)),
    );
    const opSet = new Set(
      (opRec ?? [])
        .filter((r: { linked_entry_breakdown_recipe_id: string | null }) =>
          r.linked_entry_breakdown_recipe_id != null &&
          String(r.linked_entry_breakdown_recipe_id).trim() !== ""
        )
        .map((r: { product_id: string }) => String(r.product_id)),
    );

    for (const id of matchedProductIds) {
      recipeEvidenceByProductId.set(id, {
        is_recipe_output: outSet.has(id),
        is_recipe_ingredient: ingSet.has(id),
        has_operational_recipe_link: opSet.has(id),
      });
    }
  }

  const itemsWithSim = attachPreviewLineSimulation(matchResult.items, {
    productUnitById,
    conversionsByProductId,
    recipeEvidenceByProductId,
    simulateImportBatch,
  });
  return {
    data: {
      ...ex0,
      items: itemsWithSim,
      _requiresProductConfirmation: matchResult.requiresProductConfirmation,
    },
    matchMeta: {
      deferProductCreationToReconciliation:
        matchResult.deferProductCreationToReconciliation,
      borderlineLlmCalls: matchResult.borderlineLlmCalls,
      requiresProductConfirmation: matchResult.requiresProductConfirmation,
    },
  };
}

export async function handleDevPreview(input: {
  supabase: SupabaseClient;
  companyId: string;
  fileName: string;
  xmlText: string;
  simulateImportBatch: boolean;
  aiLineUnitsPreview: boolean;
}): Promise<Response> {
  const raw = parseNfeXmlToExtracted(input.xmlText);
  if (!raw) {
    return json({
      ok: false,
      error:
        "Não foi possível ler NF-e neste XML. Confirme que é nfeProc/NFe autorizada com itens.",
    }, 422);
  }

  const { data: enriched, matchMeta } = await enrichPreviewOnly(
    input.supabase,
    input.companyId,
    raw,
    input.simulateImportBatch,
  );

  const { data: catalogRows } = await input.supabase
    .from("products")
    .select("id, name, unit")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(CATALOG_PREVIEW_LIMIT + 1);

  const catalogList = catalogRows ?? [];
  const catalogTruncated = catalogList.length > CATALOG_PREVIEW_LIMIT;
  const catalog_preview = {
    items: catalogList
      .slice(0, CATALOG_PREVIEW_LIMIT)
      .map((p: { id: string; name: string; unit: string | null }) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
      })),
    truncated: catalogTruncated,
    limit: CATALOG_PREVIEW_LIMIT,
  };

  let enrichedPayload = enriched;
  let line_units_ai: Record<string, unknown> | null = null;

  if (input.aiLineUnitsPreview) {
    const items = (enriched.items ?? []) as PreviewItem[];
    const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    const openaiModel =
      Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL") ?? "gpt-4o-mini";
    const openaiConfigured = openaiKey.length > 0;
    if (!openaiConfigured) {
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: false,
        skipped: true,
        reason:
          "OPENAI_API_KEY ausente. Defina o secret na função (Dashboard → Edge Functions → dev-preview-nfe-xml → Secrets, ou `supabase secrets set OPENAI_API_KEY=...`).",
      };
    } else if (items.length === 0) {
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: true,
        skipped: true,
        reason: "Sem linhas de itens neste documento.",
      };
    } else {
      const r = await attachLineUnitsAiPreview(items, {
        supabase: input.supabase,
        companyId: input.companyId,
        openaiKey,
        openaiModel,
      });
      enrichedPayload = { ...enriched, items: r.items };
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: true,
        calls_made: r.callsMade,
        max_per_preview: r.maxPerPreview,
        concurrency: r.concurrency,
        auto_confidence_threshold: r.autoThreshold,
        note:
          "Substituição automática de stock só quando confidence ≥ limiar E validação numérica OK (laboratório; importação real ainda não usa). Chamadas OpenAI em paralelo (LINE_UNITS_AI_CONCURRENCY).",
      };
    }
  }

  return json({
    ok: true,
    dry_run: true,
    simulate_import_batch: input.simulateImportBatch,
    ai_line_units_preview: input.aiLineUnitsPreview,
    line_units_ai,
    defer_product_creation_to_reconciliation:
      matchMeta?.deferProductCreationToReconciliation ?? null,
    borderline_llm_calls: matchMeta?.borderlineLlmCalls ?? null,
    catalog_preview,
    file_name: input.fileName || "nota.xml",
    raw,
    enriched: enrichedPayload,
    hint:
      "Extração XML é determinística (parseNfeXml). «enriched» inclui matching de produtos sem criar fornecedor. Com simulate_import_batch, o matching segue o mesmo modo da importação em lote. Com ai_line_units_preview, cada linha pode incluir _preview_line_ai_units (OpenAI). Campo _preview_line_simulation.previewLineDecision é exclusivo deste laboratório (dev_preview_only): reaproveitamento, conversões, custo sugerido e revisão manual — não usado na importação real ainda.",
  });
}

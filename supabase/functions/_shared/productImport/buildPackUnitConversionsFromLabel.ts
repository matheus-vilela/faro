/**
 * Cadastro de produto novo via XML/NF-e: nome sem embalagem no rótulo, unidade da nota
 * (fardo, cx, pct, galão…) e conversões derivadas do texto (ex.: «AÇÚCAR 10X1KG» + uCom FD → 1 fd = 10 kg).
 */
import { sanitizeCatalogProductName } from "./canonicalName.ts";
import { mapInvoiceUnitToCatalogUnit } from "./invoiceUnitToCatalogUnit.ts";
import {
  buildCommercialTaxUnitConversion,
  type NfeCommercialTaxUnitInput,
} from "./nfeCommercialTaxUnitConversion.ts";
import {
  massPerCountUnitFromLabelKg,
  packSizeFromLabel,
  stripPackSizeFromLabel,
  volumePerCountUnitFromLabelLiters,
} from "./packSizeFromLabel.ts";
import {
  loadProductUnitConversionsFromProduct,
  persistProductUnitConversionsOnProduct,
} from "../productUnitConversionsOnProduct.ts";
import {
  conversionFactorToA,
  normalizeUnitLabel,
  type NormalizedUnitCode,
} from "./unitNormalize.ts";

export type ProductUnitConversionInsert = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
};

export type NewProductCatalogFromNfeLine = {
  catalogName: string;
  stockUnit: string;
  conversions: ProductUnitConversionInsert[];
  registrationNote: string | null;
};

const PACK_INVOICE_UNITS = new Set([
  "fd",
  "cx",
  "pct",
  "gl",
  "sc",
  "mco",
  "un",
]);

function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function normalizeInvoiceCountableUnit(
  raw: string | null | undefined,
): string | null {
  const n = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!n) return null;
  if (["pct", "pacote", "pacotes", "pac"].includes(n)) return "pct";
  if (["cx", "caixa", "caixas"].includes(n)) return "cx";
  if (["fd", "fardo", "fardos"].includes(n)) return "fd";
  if (["gl", "galao", "galão", "galoes", "galões"].includes(n)) return "gl";
  if (["sc", "saco", "sacos"].includes(n)) return "sc";
  if (["mco", "maco", "macos", "maço", "maços"].includes(n)) return "mco";
  if (["un", "und", "unidade", "unidades", "uni"].includes(n)) return "un";
  return null;
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

type CompositePackMeasure = {
  outer_count: number;
  inner_value: number;
  inner_unit: NormalizedUnitCode;
  total_per_pack: number;
};

/** Ex.: «10x1kg», «10B/400g», «6 un x 1L». */
export function detectCompositePackMeasure(
  rawName: string,
): CompositePackMeasure | null {
  const name = String(rawName ?? "").trim();
  if (!name) return null;
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:b|bdj|bandejas?|band|un|und|sache|saches?|pct|pacotes?)?\s*(?:x|\/)\s*(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|l)\b/gi,
    /\b(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|l)\b/gi,
    /\b(\d+)[xX](\d+(?:[.,]\d+)?)(mg|g|kg|ml|l)\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(name);
    if (!m) continue;
    const outer = Number(String(m[1] ?? "").replace(",", "."));
    const inner = Number(String(m[2] ?? "").replace(",", "."));
    const unitRaw = String(m[3] ?? "").toLowerCase();
    if (
      !Number.isFinite(outer) ||
      !Number.isFinite(inner) ||
      outer <= 0 ||
      inner <= 0
    ) {
      continue;
    }
    const innerUnit: NormalizedUnitCode =
      unitRaw === "mg"
        ? "MG"
        : unitRaw === "g"
          ? "G"
          : unitRaw === "kg"
            ? "KG"
            : unitRaw === "ml"
              ? "ML"
              : "L";
    return {
      outer_count: roundQty(outer),
      inner_value: roundQty(inner),
      inner_unit: innerUnit,
      total_per_pack: roundQty(outer * inner),
    };
  }
  return null;
}

type EmbeddedMeasure = {
  value: number;
  unit: NormalizedUnitCode;
};

function detectEmbeddedMeasure(rawName: string): EmbeddedMeasure | null {
  const kg = massPerCountUnitFromLabelKg(rawName);
  if (kg != null && kg > 0) return { value: kg, unit: "KG" };
  const liters = volumePerCountUnitFromLabelLiters(rawName);
  if (liters != null && liters > 0) return { value: liters, unit: "L" };
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
    unit:
      u === "mg"
        ? "MG"
        : u === "g"
          ? "G"
          : u === "kg"
            ? "KG"
            : u === "ml"
              ? "ML"
              : "L",
  };
}

function qtyInCatalogUnit(
  amount: number,
  from: NormalizedUnitCode,
  toCode: string,
): number | null {
  const toNorm = normalizeUnitLabel(toCode);
  if (toNorm === "UNKN") return null;
  const f = conversionFactorToA(toNorm, from);
  if (f == null) return null;
  return roundQty(amount * f);
}

/** Inclui kg/g/mg ou l/ml proporcionais a partir da conversão base. */
function expandMassVolumeConversionFamily(
  primaryUnit: string,
  totalInBaseUnit: number,
  baseNorm: NormalizedUnitCode,
): ProductUnitConversionInsert[] {
  const massUnits: NormalizedUnitCode[] = ["KG", "G", "MG"];
  const volUnits: NormalizedUnitCode[] = ["L", "ML"];
  const family = massUnits.includes(baseNorm)
    ? massUnits
    : volUnits.includes(baseNorm)
      ? volUnits
      : [baseNorm];
  const out: ProductUnitConversionInsert[] = [];
  const seen = new Set<string>();
  for (const u of family) {
    const code = normalizedToCatalogCode(u);
    if (!code || seen.has(code)) continue;
    const qty = qtyInCatalogUnit(totalInBaseUnit, baseNorm, code);
    if (qty == null || qty <= 0) continue;
    seen.add(code);
    out.push({
      primary_qty: 1,
      primary_unit_code: primaryUnit,
      secondary_qty: qty,
      secondary_unit_code: code,
    });
  }
  return out;
}

function conversionKey(c: ProductUnitConversionInsert): string {
  return `${c.primary_unit_code}:${c.secondary_unit_code}`;
}

const MIN_INNER_UNITS = 2;

/** Quantidade de unidades (un) dentro de 1 embalagem de estoque (fd, cx, …). */
function innerUnitCountFromPackLabel(
  rawName: string,
  composite: CompositePackMeasure | null,
): number | null {
  if (composite && composite.outer_count >= MIN_INNER_UNITS) {
    return composite.outer_count;
  }
  const { packFactor } = packSizeFromLabel(rawName);
  if (packFactor != null && packFactor >= MIN_INNER_UNITS) {
    return packFactor;
  }
  return null;
}

function conversionPackToInnerUnits(
  stockUnit: string,
  innerUnits: number,
): ProductUnitConversionInsert {
  return {
    primary_qty: 1,
    primary_unit_code: stockUnit,
    secondary_qty: roundQty(innerUnits),
    secondary_unit_code: "un",
  };
}

/** Massa/volume no rótulo é por unidade interna; na unidade de estoque (cx, fd…) multiplica. */
function measureQtyPerStockUnit(
  perUnitQty: number,
  stockUnit: string,
  innerUnits: number | null,
): number {
  if (innerUnits != null && stockUnit !== "un") {
    return roundQty(perUnitQty * innerUnits);
  }
  return roundQty(perUnitQty);
}

/**
 * Volume/massa no xProd (ex.: 330 ml, 0,330GFA) é por unidade consumível (garrafa/un),
 * não pelo total da caixa. Com N un por embalagem, conversões L/ml/kg ficam em `un`.
 */
function shouldAnchorMassVolumeOnInnerUnit(
  innerUnits: number | null,
): boolean {
  return innerUnits != null && innerUnits >= MIN_INNER_UNITS;
}

function massVolumePrimaryUnit(
  stockUnit: string,
  innerUnits: number | null,
): string {
  return shouldAnchorMassVolumeOnInnerUnit(innerUnits) ? "un" : stockUnit;
}

function massVolumeMeasureQty(
  measurePerInnerUnit: number,
  stockUnit: string,
  innerUnits: number | null,
): number {
  if (shouldAnchorMassVolumeOnInnerUnit(innerUnits)) {
    return roundQty(measurePerInnerUnit);
  }
  return measureQtyPerStockUnit(measurePerInnerUnit, stockUnit, innerUnits);
}

export function dedupeProductUnitConversions(
  rows: ProductUnitConversionInsert[],
): ProductUnitConversionInsert[] {
  const out: ProductUnitConversionInsert[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = conversionKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Monta nome, unidade de estoque e conversões para insert em `products` + `product_unit_conversions`.
 */
export function mergeProductUnitConversionGroups(
  ...groups: ProductUnitConversionInsert[][]
): ProductUnitConversionInsert[] {
  return dedupeProductUnitConversions(groups.flat());
}

function applyCommercialTaxUnitOverlay(
  base: NewProductCatalogFromNfeLine,
  nfeUnits: NfeCommercialTaxUnitInput,
): NewProductCatalogFromNfeLine {
  const ct = buildCommercialTaxUnitConversion(nfeUnits);
  if (!ct) return base;
  const noteParts = [ct.note, base.registrationNote].filter(Boolean);
  return {
    catalogName: base.catalogName,
    stockUnit: ct.stockUnit,
    conversions: mergeProductUnitConversionGroups(
      ct.conversions,
      base.conversions,
    ),
    registrationNote: noteParts.length > 0 ? noteParts.join("; ") : null,
  };
}

export function buildNewProductCatalogFromNfeLine(input: {
  productName: string;
  invoiceUnitRaw: string | null | undefined;
  /** Nome sugerido pela IA (já normalizado); se vazio, deriva do xProd. */
  suggestedCatalogName?: string | null;
  /** uCom / uTrib e quantidades da NF-e para conversão automática. */
  unitCommercial?: string | null;
  unitTax?: string | null;
  quantityCommercial?: number | null;
  quantityTax?: number | null;
}): NewProductCatalogFromNfeLine {
  const rawName = String(input.productName ?? "").trim() || "Item";
  const stripped = stripPackSizeFromLabel(
    String(input.suggestedCatalogName ?? "").trim() || rawName,
  ).trim();
  const catalogName =
    sanitizeCatalogProductName(stripped || rawName) ||
    sanitizeCatalogProductName("Item");

  const mapped = mapInvoiceUnitToCatalogUnit(input.invoiceUnitRaw);
  const invoiceCountable =
    normalizeInvoiceCountableUnit(mapped.unit) ??
    normalizeInvoiceCountableUnit(mapped.rawUnit);

  const composite = detectCompositePackMeasure(rawName);
  const embedded = detectEmbeddedMeasure(rawName);

  const conversions: ProductUnitConversionInsert[] = [];
  let registrationNote: string | null = null;

  if (invoiceCountable && PACK_INVOICE_UNITS.has(invoiceCountable)) {
    const stockUnit = invoiceCountable;
    const innerUnits = innerUnitCountFromPackLabel(rawName, composite);
    const notes: string[] = [];

    if (stockUnit !== "un" && innerUnits != null) {
      conversions.push(conversionPackToInnerUnits(stockUnit, innerUnits));
      notes.push(`1 ${stockUnit} = ${innerUnits} un`);
    }

    if (composite) {
      const baseCode = normalizedToCatalogCode(composite.inner_unit);
      if (baseCode) {
        const mvPrimary = massVolumePrimaryUnit(stockUnit, innerUnits);
        const mvQty = shouldAnchorMassVolumeOnInnerUnit(innerUnits)
          ? composite.inner_value
          : composite.total_per_pack;
        conversions.push(
          ...expandMassVolumeConversionFamily(
            mvPrimary,
            mvQty,
            composite.inner_unit,
          ),
        );
        if (shouldAnchorMassVolumeOnInnerUnit(innerUnits)) {
          notes.push(
            `1 un = ${composite.inner_value} ${baseCode} (${composite.outer_count}× por ${stockUnit})`,
          );
        } else {
          notes.push(
            `${composite.outer_count}×${composite.inner_value} ${baseCode} → 1 ${stockUnit} = ${composite.total_per_pack} ${baseCode}`,
          );
        }
      }
    } else if (embedded) {
      const embCode = normalizedToCatalogCode(embedded.unit);
      if (embCode) {
        const mvPrimary = massVolumePrimaryUnit(stockUnit, innerUnits);
        const mvQty = massVolumeMeasureQty(
          embedded.value,
          stockUnit,
          innerUnits,
        );
        conversions.push(
          ...expandMassVolumeConversionFamily(
            mvPrimary,
            mvQty,
            embedded.unit,
          ),
        );
        if (shouldAnchorMassVolumeOnInnerUnit(innerUnits)) {
          notes.push(
            `1 un = ${embedded.value} ${embCode}` +
              (innerUnits != null && stockUnit !== "un"
                ? ` (${innerUnits} un por ${stockUnit})`
                : ""),
          );
        } else if (innerUnits != null && stockUnit !== "un") {
          const totalPerPack = measureQtyPerStockUnit(
            embedded.value,
            stockUnit,
            innerUnits,
          );
          notes.push(
            `${innerUnits} un × ${embedded.value} ${embCode} → 1 ${stockUnit} = ${totalPerPack} ${embCode}`,
          );
        } else {
          notes.push(`1 ${stockUnit} = ${mvQty} ${embCode}`);
        }
      }
    } else if (invoiceCountable === "mco") {
      // Estoque já é mco; conversão mco→mco viola o trigger (secundária = estoque).
      notes.push("Unidade de estoque: maço (mco)");
    }

    if (notes.length > 0) {
      registrationNote = `Embalagem no nome: ${notes.join("; ")}`;
    }

    return applyCommercialTaxUnitOverlay(
      {
        catalogName,
        stockUnit,
        conversions: dedupeProductUnitConversions(conversions),
        registrationNote,
      },
      input,
    );
  }

  const invNorm = normalizeUnitLabel(
    String(input.invoiceUnitRaw ?? "").trim() || mapped.unit,
  );
  if (invNorm === "KG" || invNorm === "G" || invNorm === "MG") {
    return applyCommercialTaxUnitOverlay(
      {
        catalogName,
        stockUnit: "un",
        conversions: dedupeProductUnitConversions(
          // primary_unit_code deve ser a unidade de estoque ("un"), não a unidade da NF-e.
          expandMassVolumeConversionFamily("un", 100, "G"),
        ),
        registrationNote: "Nota em massa: estoque em un com ponte 1 un = 100 g",
      },
      input,
    );
  }
  if (invNorm === "L" || invNorm === "ML") {
    return applyCommercialTaxUnitOverlay(
      {
        catalogName,
        stockUnit: "un",
        conversions: dedupeProductUnitConversions(
          expandMassVolumeConversionFamily("un", 100, "ML"),
        ),
        registrationNote: "Nota em volume: estoque em un com ponte 1 un = 100 ml",
      },
      input,
    );
  }

  const stockUnit = mapped.needsReview
    ? (invoiceCountable ?? "un")
    : mapped.unit.slice(0, 32) || "un";

  return applyCommercialTaxUnitOverlay(
    {
      catalogName,
      stockUnit,
      conversions: [],
      registrationNote: null,
    },
    input,
  );
}

export async function insertProductUnitConversions(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  companyId: string,
  productId: string,
  conversions: ProductUnitConversionInsert[],
  logPrefix: string,
): Promise<void> {
  if (!conversions.length) return;

  const { data: productRow, error: productErr } = await supabase
    .from("products")
    .select("unit")
    .eq("id", productId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (productErr || !productRow?.unit) {
    console.error(
      logPrefix,
      "unit_conversions",
      "produto_nao_encontrado",
      productErr?.message ?? productId,
    );
    return;
  }
  const stockUnit = String(productRow.unit).trim().toLowerCase();
  const existing = await loadProductUnitConversionsFromProduct(supabase, productId);
  const merged = [...existing];

  for (const c of conversions) {
    const secondary = String(c.secondary_unit_code).trim().toLowerCase();
    if (!secondary || secondary === stockUnit) {
      console.warn(
        logPrefix,
        "unit_conversions_skip",
        JSON.stringify({
          product_id: productId,
          motivo: "secundaria_igual_estoque_ou_vazia",
          secondary,
          stock_unit: stockUnit,
        }),
      );
      continue;
    }
    const idx = merged.findIndex(
      (r) => r.secondary_unit_code.toLowerCase() === secondary,
    );
    const row = {
      primary_qty: Number(c.primary_qty) > 0 ? Number(c.primary_qty) : 1,
      primary_unit_code: stockUnit,
      secondary_qty: Number(c.secondary_qty) > 0 ? Number(c.secondary_qty) : 1,
      secondary_unit_code: secondary,
    };
    if (idx >= 0) merged[idx] = row;
    else merged.push(row);
  }

  const { ok, error } = await persistProductUnitConversionsOnProduct(
    supabase,
    productId,
    merged,
  );
  if (!ok) {
    console.error(logPrefix, "unit_conversions", error ?? "persist_failed");
  }
}

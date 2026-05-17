/**
 * Cadastro de produto novo via XML/NF-e: nome sem embalagem no rótulo, unidade da nota
 * (fardo, cx, pct, galão…) e conversões derivadas do texto (ex.: «AÇÚCAR 10X1KG» + uCom FD → 1 fd = 10 kg).
 */
import { sanitizeCatalogProductName } from "./canonicalName.ts";
import { mapInvoiceUnitToCatalogUnit } from "./invoiceUnitToCatalogUnit.ts";
import {
  massPerCountUnitFromLabelKg,
  packSizeFromLabel,
  stripPackSizeFromLabel,
  volumePerCountUnitFromLabelLiters,
} from "./packSizeFromLabel.ts";
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

function dedupeConversions(
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
export function buildNewProductCatalogFromNfeLine(input: {
  productName: string;
  invoiceUnitRaw: string | null | undefined;
  /** Nome sugerido pela IA (já normalizado); se vazio, deriva do xProd. */
  suggestedCatalogName?: string | null;
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
        const total = composite.total_per_pack;
        conversions.push(
          ...expandMassVolumeConversionFamily(
            stockUnit,
            total,
            composite.inner_unit,
          ),
        );
        notes.push(
          `${composite.outer_count}×${composite.inner_value} ${baseCode} → 1 ${stockUnit} = ${total} ${baseCode}`,
        );
      }
    } else if (embedded) {
      const embCode = normalizedToCatalogCode(embedded.unit);
      if (embCode) {
        const totalPerPack = measureQtyPerStockUnit(
          embedded.value,
          stockUnit,
          innerUnits,
        );
        conversions.push(
          ...expandMassVolumeConversionFamily(
            stockUnit,
            totalPerPack,
            embedded.unit,
          ),
        );
        if (innerUnits != null && stockUnit !== "un") {
          notes.push(
            `${innerUnits} un × ${embedded.value} ${embCode} → 1 ${stockUnit} = ${totalPerPack} ${embCode}`,
          );
        } else {
          notes.push(`1 ${stockUnit} = ${totalPerPack} ${embCode}`);
        }
      }
    } else if (invoiceCountable === "mco") {
      conversions.push({
        primary_qty: 1,
        primary_unit_code: stockUnit,
        secondary_qty: 1,
        secondary_unit_code: "mco",
      });
      notes.push("1 unidade de estoque = 1 mco");
    }

    if (notes.length > 0) {
      registrationNote = `Embalagem no nome: ${notes.join("; ")}`;
    }

    return {
      catalogName,
      stockUnit,
      conversions: dedupeConversions(conversions),
      registrationNote,
    };
  }

  const invNorm = normalizeUnitLabel(
    String(input.invoiceUnitRaw ?? "").trim() || mapped.unit,
  );
  if (invNorm === "KG" || invNorm === "G" || invNorm === "MG") {
    return {
      catalogName,
      stockUnit: "un",
      conversions: dedupeConversions(
        expandMassVolumeConversionFamily(invNorm, 100, "G"),
      ),
      registrationNote: "Nota em massa: estoque em un com ponte 1 un = 100 g",
    };
  }
  if (invNorm === "L" || invNorm === "ML") {
    return {
      catalogName,
      stockUnit: "un",
      conversions: dedupeConversions(
        expandMassVolumeConversionFamily(invNorm, 100, "ML"),
      ),
      registrationNote: "Nota em volume: estoque em un com ponte 1 un = 100 ml",
    };
  }

  const stockUnit = mapped.needsReview
    ? (invoiceCountable ?? "un")
    : mapped.unit.slice(0, 32) || "un";

  return {
    catalogName,
    stockUnit,
    conversions: [],
    registrationNote: null,
  };
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
  for (const c of conversions) {
    const { error } = await supabase.from("product_unit_conversions").insert({
      company_id: companyId,
      product_id: productId,
      primary_qty: c.primary_qty,
      primary_unit_code: c.primary_unit_code,
      secondary_qty: c.secondary_qty,
      secondary_unit_code: c.secondary_unit_code,
    });
    if (error) {
      console.error(
        logPrefix,
        "product_unit_conversions",
        c.secondary_unit_code,
        error.message,
      );
    }
  }
}

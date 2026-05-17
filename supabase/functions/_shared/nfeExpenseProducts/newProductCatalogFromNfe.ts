/**
 * Paridade com o laboratório `dev-preview-nfe-xml` para **cadastro** de produto novo
 * a partir da linha NF-e: nome sem embalagem/medida típica no rótulo (`stripPackSizeFromLabel`)
 * e unidade derivada da nota com `normalizeUnitLabel` quando reconhecível.
 */
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import type { ItemWithProductMatch } from "../../received-whatsapp-message/productMatch.ts";
import {
  pickInvoiceUnitRaw,
  type ExtractedItemWithInvoiceMeta,
} from "../productImport/consolidateItems.ts";
import { sanitizeCatalogProductName } from "../productImport/canonicalName.ts";
import { stripPackSizeFromLabel } from "../productImport/packSizeFromLabel.ts";
import {
  normalizeUnitLabel,
  type NormalizedUnitCode,
} from "../productImport/unitNormalize.ts";

function pickCatalogUnitFromLineUnitsAssist(
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): string | null {
  const raw = pm.invoice_line_units_llm as Record<string, unknown> | undefined;
  if (!raw || String(raw.kind ?? "") !== "OK") return null;
  const t = String(raw.catalog_unit_target ?? "").trim();
  return t || null;
}

function pickBaseNameForCatalog(
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): string {
  const raw = String(item.productName ?? "").trim() || "Item";
  const llm = String(pm.borderlineLlmSuggestedName ?? "").trim();
  const base = llm || raw;
  const stripped = stripPackSizeFromLabel(base).trim();
  if (stripped) return stripped;
  return stripPackSizeFromLabel(raw).trim() || raw;
}

/**
 * Nome a gravar em `products.name` / exibição pós-import (equivalente a `catalogNameForRegistration` no preview).
 */
export function catalogRegistrationNameFromNfeLine(
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): string {
  const base = pickBaseNameForCatalog(item, pm);
  return sanitizeCatalogProductName(base) || sanitizeCatalogProductName("Item");
}

/**
 * Unidade inicial do cadastro: prioriza uCom da nota normalizada; fallback código da nota no match.
 */
export function catalogRegistrationUnitFromNfeLine(
  item: ExtractedExpenseItem,
  pm?: ItemWithProductMatch["productMatch"],
): string {
  if (pm) {
    const fromAssist = pickCatalogUnitFromLineUnitsAssist(pm);
    if (fromAssist) {
      const n = normalizeUnitLabel(fromAssist);
      if (n && n !== "UNKN") {
        const s = String(n).trim();
        return s.length <= 32 ? s : s.slice(0, 32);
      }
    }
  }
  const raw = pickInvoiceUnitRaw(item as ExtractedItemWithInvoiceMeta);
  const trimmed = raw?.trim() ?? "";
  if (trimmed) {
    const n = normalizeUnitLabel(trimmed);
    if (n && n !== "UNKN") {
      const s = String(n).trim();
      return s.length <= 32 ? s : s.slice(0, 32);
    }
    return trimmed.slice(0, 32);
  }
  const inv = pm?.invoiceUnitNormalized;
  if (inv != null && String(inv).trim()) {
    const s = String(inv).trim();
    return s.length > 32 ? s.slice(0, 32) : s;
  }
  return "UN";
}

const PACK_G = 100;
const PACK_ML = 100;

/**
 * Para cadastro automático sem fila na Central: prioriza estoque em `un` com conversão
 * 1 un = 100 g ou 100 ml quando a nota está em família massa/volume (paridade com preview NF-e).
 */
export function autoCatalogStockUnitWithOptionalUnPack(
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): {
  stockUnit: string;
  pack: { secondary_unit_code: string; secondary_qty: number } | null;
} {
  const base = catalogRegistrationUnitFromNfeLine(item, pm);
  const inv = String(pm.invoiceUnitNormalized ?? "").trim();
  const raw = pickInvoiceUnitRaw(item as ExtractedItemWithInvoiceMeta)?.trim() ?? "";
  const n = normalizeUnitLabel(inv || raw || base) as NormalizedUnitCode;
  if (n === "KG" || n === "G" || n === "MG") {
    return {
      stockUnit: "un",
      pack: { secondary_unit_code: "g", secondary_qty: PACK_G },
    };
  }
  if (n === "L" || n === "ML") {
    return {
      stockUnit: "un",
      pack: { secondary_unit_code: "ml", secondary_qty: PACK_ML },
    };
  }
  const lowRaw = base.trim().toLowerCase();
  const low = lowRaw === "und" ? "un" : lowRaw;
  return { stockUnit: low || "un", pack: null };
}

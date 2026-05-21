/**
 * Catálogo global de fornecedores/produtos a partir de XML NF-e (focus-get-sync-nfe).
 */
import { normalizeTaxIdForSupplierDocument } from "./expenseSupplierEnsure.ts";
import {
  computeEffectiveUnitPricesForCatalogLines,
  effectiveUnitPriceWithoutGlobalAllocation,
} from "./nfeEffectiveUnitPrice.ts";
import { priceBoundNfeXmlUpdates } from "./nfePriceBoundXml.ts";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";

export { priceBoundNfeXmlUpdates } from "./nfePriceBoundXml.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

const LOG = "[unified-supplier-catalog]";

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeEanDigits(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d || d === "0") return null;
  return d;
}

function eanFromProd(prod: Record<string, unknown>): string | null {
  const raw =
    str(prod.cEAN) ??
    str(prod.cEANTrib) ??
    str(prod.cEan) ??
    str(prod.ceantrib);
  if (!raw || raw.toUpperCase() === "SEM GTIN") return null;
  return normalizeEanDigits(raw);
}

function eansDiffer(a: string | null, b: string | null): boolean {
  const na = normalizeEanDigits(a);
  const nb = normalizeEanDigits(b);
  if (!na && !nb) return false;
  if (!na || !nb) return true;
  return na !== nb;
}

function roundUnitPrice(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Preço unitário da linha NF-e (vUnCom; senão vProd / qCom). Não inclui descontos/acréscimos. */
export function unitPriceFromNfeLine(
  unitValue: number | null,
  quantity: number | null,
  lineTotal: number | null,
): number | null {
  if (unitValue != null && unitValue > 0) return roundUnitPrice(unitValue);
  const q = quantity != null && quantity > 0 ? quantity : null;
  const lt = lineTotal != null && lineTotal > 0 ? lineTotal : null;
  if (q != null && lt != null) return roundUnitPrice(lt / q);
  return null;
}

/** Unitário efetivo observado: rateio global + ajustes de linha; fallback só com ajustes da linha. */
export function observedUnitPriceFromNfeLine(
  effectiveUnitPrice: number | null | undefined,
  prod: Record<string, unknown>,
): number | null {
  if (effectiveUnitPrice != null && effectiveUnitPrice > 0) {
    return roundUnitPrice(effectiveUnitPrice);
  }
  return effectiveUnitPriceWithoutGlobalAllocation(prod);
}

export function mergeMinMaxPrice(
  observed: number | null,
  existingMin: number | null | undefined,
  existingMax: number | null | undefined,
): { min_price: number | null; max_price: number | null } {
  const prevMin =
    existingMin != null && Number.isFinite(Number(existingMin))
      ? Number(existingMin)
      : null;
  const prevMax =
    existingMax != null && Number.isFinite(Number(existingMax))
      ? Number(existingMax)
      : null;

  if (observed == null || !(observed > 0)) {
    return { min_price: prevMin, max_price: prevMax };
  }

  return {
    min_price: prevMin == null ? observed : Math.min(prevMin, observed),
    max_price: prevMax == null ? observed : Math.max(prevMax, observed),
  };
}

export type UpsertUnifiedCatalogResult = {
  ok: boolean;
  supplierId: string | null;
  productsUpserted: number;
  historyRows: number;
  skippedReason?: string;
};

/**
 * Garante fornecedor global (CPF/CNPJ) e produtos (cProd) a partir do XML.
 * Ignora XML sem documento fiscal válido ou linhas sem cProd.
 */
function priceBoundsChanged(
  prevMin: number | null,
  prevMax: number | null,
  bounds: { min_price: number | null; max_price: number | null },
): boolean {
  const eps = 1e-9;
  const minCh =
    bounds.min_price != null &&
    (prevMin == null || Math.abs(bounds.min_price - prevMin) > eps);
  const maxCh =
    bounds.max_price != null &&
    (prevMax == null || Math.abs(bounds.max_price - prevMax) > eps);
  return minCh || maxCh;
}

/** Campos de menor/maior preço + XML da NF-e (só inclui o que mudou). */
function buildGlobalProductPriceFields(
  prevMin: number | null,
  prevMax: number | null,
  observedUnitPrice: number | null,
  nfeSnapshot?: { chave_nfe: string | null; xml_text: string | null },
  isNewProduct: boolean,
): Record<string, unknown> {
  if (observedUnitPrice == null || !(observedUnitPrice > 0)) return {};

  const bounds = mergeMinMaxPrice(observedUnitPrice, prevMin, prevMax);
  const xmlUpdates = priceBoundNfeXmlUpdates({
    observed: observedUnitPrice,
    prevMin,
    prevMax,
    bounds,
    chaveNfe: nfeSnapshot?.chave_nfe ?? null,
    xmlText: nfeSnapshot?.xml_text ?? null,
  });

  if (isNewProduct) {
    return {
      min_price: bounds.min_price,
      max_price: bounds.max_price,
      ...xmlUpdates,
    };
  }

  const boundsCh = priceBoundsChanged(prevMin, prevMax, bounds);
  const hasXml = Object.keys(xmlUpdates).length > 0;
  if (!boundsCh && !hasXml) return {};

  const patch: Record<string, unknown> = { ...xmlUpdates };
  if (boundsCh) {
    patch.min_price = bounds.min_price;
    patch.max_price = bounds.max_price;
  }
  return patch;
}

export async function upsertUnifiedSupplierCatalogFromNfeXml(
  admin: SupabaseAdmin,
  xmlText: string,
  meta?: { chave_nfe?: string | null; company_id?: string | null },
): Promise<UpsertUnifiedCatalogResult> {
  const companyId = meta?.company_id?.trim() || null;
  if (!companyId) {
    return {
      ok: false,
      supplierId: null,
      productsUpserted: 0,
      historyRows: 0,
      skippedReason: "missing_company_id",
    };
  }

  const parsed = parseNfeXmlForUnifiedCatalog(xmlText);
  if (!parsed) {
    return {
      ok: false,
      supplierId: null,
      productsUpserted: 0,
      historyRows: 0,
      skippedReason: "parse_failed_or_no_det",
    };
  }

  const taxDocument = normalizeTaxIdForSupplierDocument(
    parsed.emit.supplierDocument,
  );
  if (!taxDocument || (taxDocument.length !== 11 && taxDocument.length !== 14)) {
    return {
      ok: false,
      supplierId: null,
      productsUpserted: 0,
      historyRows: 0,
      skippedReason: "invalid_supplier_document",
    };
  }

  const chaveNfe =
    meta?.chave_nfe?.replace(/\D/g, "") ||
    parsed.emit.nfeAccessKey?.replace(/\D/g, "") ||
    null;

  const nowIso = new Date().toISOString();
  const supplierName = (parsed.emit.supplierName ?? "").trim() || "Fornecedor NF-e";
  const fantasyName = parsed.emit.fantasyName?.trim() || null;

  const { data: existingSupplier, error: selSupErr } = await admin
    .from("unified_suppliers")
    .select("id, name, fantasy_name, sighting_count")
    .eq("tax_document", taxDocument)
    .maybeSingle();

  if (selSupErr) {
    console.error(LOG, "supplier_select_err", selSupErr.message);
    return {
      ok: false,
      supplierId: null,
      productsUpserted: 0,
      historyRows: 0,
      skippedReason: selSupErr.message,
    };
  }

  let supplierId: string;

  if (existingSupplier?.id) {
    supplierId = String(existingSupplier.id);
    const { error: updSupErr } = await admin
      .from("unified_suppliers")
      .update({
        name: supplierName,
        fantasy_name: fantasyName,
        last_seen_at: nowIso,
        sighting_count: Number(existingSupplier.sighting_count ?? 1) + 1,
      })
      .eq("id", supplierId);
    if (updSupErr) {
      console.error(LOG, "supplier_update_err", updSupErr.message);
      return {
        ok: false,
        supplierId: null,
        productsUpserted: 0,
        historyRows: 0,
        skippedReason: updSupErr.message,
      };
    }
  } else {
    const { data: insSup, error: insSupErr } = await admin
      .from("unified_suppliers")
      .insert({
        tax_document: taxDocument,
        name: supplierName,
        fantasy_name: fantasyName,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        sighting_count: 1,
      })
      .select("id")
      .single();
    if (insSupErr || !insSup?.id) {
      console.error(LOG, "supplier_insert_err", insSupErr?.message ?? "no_id");
      return {
        ok: false,
        supplierId: null,
        productsUpserted: 0,
        historyRows: 0,
        skippedReason: insSupErr?.message ?? "supplier_insert_no_id",
      };
    }
    supplierId = String(insSup.id);
  }

  const effectiveByIndex = computeEffectiveUnitPricesForCatalogLines(
    parsed.lines,
    xmlText,
  );

  let productsUpserted = 0;
  let historyRows = 0;

  for (let lineIdx = 0; lineIdx < parsed.lines.length; lineIdx += 1) {
    const line = parsed.lines[lineIdx]!;
    const cProd = str(line.prod.cProd ?? line.prod.cprod);
    if (!cProd) continue;

    const productName = str(line.prod.xProd) ?? "Item";
    const ean = eanFromProd(line.prod);
    const ncmRaw = str(line.prod.NCM ?? line.prod.ncm);
    const ncm = ncmRaw ? ncmRaw.replace(/\D/g, "").slice(0, 8) || null : null;
    const uCom = str(line.prod.uCom);
    const uTrib = str(line.prod.uTrib);
    const effective = effectiveByIndex[lineIdx];
    const observedUnitPrice = observedUnitPriceFromNfeLine(
      effective?.effectiveUnitPrice,
      line.prod,
    );

    const { data: existingProduct, error: selProdErr } = await admin
      .from("unified_supplier_products")
      .select(
        "id, product_name, ean, sighting_count, min_price, max_price",
      )
      .eq("unified_supplier_id", supplierId)
      .eq("c_prod", cProd)
      .maybeSingle();

    if (selProdErr) {
      console.error(LOG, "product_select_err", cProd, selProdErr.message);
      continue;
    }

    const prevMin =
      existingProduct?.min_price != null &&
        Number.isFinite(Number(existingProduct.min_price))
        ? Number(existingProduct.min_price)
        : null;
    const prevMax =
      existingProduct?.max_price != null &&
        Number.isFinite(Number(existingProduct.max_price))
        ? Number(existingProduct.max_price)
        : null;

    const priceFields = buildGlobalProductPriceFields(
      prevMin,
      prevMax,
      observedUnitPrice,
      { chave_nfe: chaveNfe, xml_text: xmlText },
      !existingProduct?.id,
    );

    const productRow = {
      unified_supplier_id: supplierId,
      c_prod: cProd,
      product_name: productName,
      ean,
      ncm,
      cfop: line.cfop,
      csosn: line.csosn,
      unit_commercial: uCom,
      unit_tax: uTrib && uCom && uTrib !== uCom ? uTrib : null,
      xml_prod: line.prod,
      xml_det: line.xmlDet,
      last_seen_at: nowIso,
      ...priceFields,
    };

    if (existingProduct?.id) {
      const prevName = String(existingProduct.product_name ?? "");
      const prevEan = existingProduct.ean != null
        ? String(existingProduct.ean)
        : null;

      if (eansDiffer(prevEan, ean)) {
        const { error: histErr } = await admin
          .from("unified_supplier_product_description_history")
          .insert({
            unified_supplier_product_id: String(existingProduct.id),
            previous_product_name: prevName || null,
            new_product_name: productName,
            previous_ean: prevEan,
            new_ean: ean,
            chave_nfe: chaveNfe,
            observed_at: nowIso,
          });
        if (histErr) {
          console.error(LOG, "history_insert_err", histErr.message);
        } else {
          historyRows += 1;
        }
      }

      const { error: updProdErr } = await admin
        .from("unified_supplier_products")
        .update({
          ...productRow,
          sighting_count: Number(existingProduct.sighting_count ?? 1) + 1,
        })
        .eq("id", existingProduct.id);
      if (updProdErr) {
        console.error(LOG, "product_update_err", cProd, updProdErr.message);
        continue;
      }
      productsUpserted += 1;
    } else {
      const { data: insProd, error: insProdErr } = await admin
        .from("unified_supplier_products")
        .insert({
          ...productRow,
          first_seen_at: nowIso,
          sighting_count: 1,
        })
        .select("id")
        .single();
      if (insProdErr || !insProd?.id) {
        console.error(LOG, "product_insert_err", cProd, insProdErr?.message);
        continue;
      }
      productsUpserted += 1;
    }
  }

  return {
    ok: true,
    supplierId,
    productsUpserted,
    historyRows,
  };
}

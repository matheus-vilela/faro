/**
 * Extrai dados mínimos de NF-e / NFC-e (XML autorizado) para pré-preencher despesa.
 */
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import type { ExtractedDocumentResult, ExtractedExpenseItem } from "./openaiExpense.ts";

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function normalizeDateOnly(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function stripBom(s: string): string {
  const t = s.trim();
  if (t.charCodeAt(0) === 0xfeff) return t.slice(1).trim();
  return t;
}

function pickNFeRoot(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const el of arr) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    if (o.infNFe != null) return o;
  }
  return undefined;
}

/** Vários `infNFe` no mesmo ficheiro: preferir bloco com `det` (itens). */
function pickInfNFe(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const el of arr) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    if (o.det != null) return o;
  }
  for (const el of arr) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    return el as Record<string, unknown>;
  }
  return undefined;
}

/** `det` único, vários `det`, ou mapa indexado pelo parser. */
function normalizeDetList(detRaw: unknown): Record<string, unknown>[] {
  if (detRaw == null) return [];
  if (Array.isArray(detRaw)) {
    return detRaw.filter((d) => d && typeof d === "object" && !Array.isArray(d)) as Record<
      string,
      unknown
    >[];
  }
  if (typeof detRaw !== "object") return [];
  const o = detRaw as Record<string, unknown>;
  if ("prod" in o || "imposto" in o) return [o];
  const vals = Object.values(o).filter(
    (v) => v && typeof v === "object" && !Array.isArray(v),
  ) as Record<string, unknown>[];
  if (vals.length > 0 && vals.every((v) => "prod" in v || "imposto" in v)) return vals;
  return [];
}

function normalizeProd(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
    return undefined;
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}

/** CFOP (4 dígitos) e CSOSN/CST do bloco ICMS do `det`. */
function extractCfopAndCsosnFromDet(det: Record<string, unknown>): {
  cfop: string | null;
  csosn: string | null;
} {
  const prod = normalizeProd(det.prod);
  const cfopDigits = String(prod?.CFOP ?? prod?.cfop ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  const cfop = cfopDigits.length === 4 ? cfopDigits : null;

  const imposto = det.imposto as Record<string, unknown> | undefined;
  const icmsRaw = imposto?.ICMS ?? imposto?.icms;
  const icms = (
    Array.isArray(icmsRaw) ? icmsRaw[0] : icmsRaw
  ) as Record<string, unknown> | undefined;

  let csosn: string | null = null;
  if (icms && typeof icms === "object") {
    for (const block of Object.values(icms)) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const b = block as Record<string, unknown>;
      const fromCsosn = str(b.CSOSN ?? b.csosn);
      if (fromCsosn) {
        csosn = fromCsosn.replace(/\D/g, "");
        break;
      }
      const fromCst = str(b.CST ?? b.cst);
      if (fromCst) {
        csosn = fromCst.replace(/\D/g, "");
        break;
      }
    }
  }
  const csosnNorm =
    csosn && csosn.length >= 2 ? csosn.slice(0, 4) : null;

  return { cfop, csosn: csosnNorm };
}

/** Aceita nfeProc, NFe sem wrapper, ou XML com namespace */
export function parseNfeXmlToExtracted(xmlText: string): ExtractedDocumentResult | null {
  const trimmed = stripBom(xmlText);
  if (!trimmed.startsWith("<")) return null;

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  let root: Record<string, unknown>;
  try {
    root = parser.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const nfeProc = root.nfeProc as Record<string, unknown> | undefined;
  const nfeRoot = pickNFeRoot(nfeProc?.NFe ?? root.NFe);
  const infNFe = pickInfNFe(nfeRoot?.infNFe);
  if (!infNFe || typeof infNFe !== "object") {
    return null;
  }

  const emit = infNFe.emit as Record<string, unknown> | undefined;
  const supplierName = str(emit?.xNome ?? emit?.xFant) ?? "Emitente NF-e";
  const cnpj = str(emit?.CNPJ ?? emit?.CPF);
  const supplierDocument = cnpj ? cnpj.replace(/\D/g, "") : null;

  const ide = infNFe.ide as Record<string, unknown> | undefined;
  const invoiceNumber = str(ide?.nNF);
  const invoiceSeries = str(ide?.serie);
  const emissionDate = normalizeDateOnly(ide?.dhEmi ?? ide?.dEmi);
  const infNFeId = str((infNFe as Record<string, unknown>)["@_Id"]);
  const nfeAccessKey = infNFeId?.startsWith("NFe") ? infNFeId.slice(3) : infNFeId;

  const total = infNFe.total as Record<string, unknown> | undefined;
  const icmsRaw = total?.ICMSTot;
  const icmsTot = (
    Array.isArray(icmsRaw) ? icmsRaw[0] : icmsRaw
  ) as Record<string, unknown> | undefined;
  let totalAmount = num(icmsTot?.vNF);
  if (!(totalAmount > 0)) {
    totalAmount = num((total as Record<string, unknown> | undefined)?.vNF);
  }

  const detList = normalizeDetList(infNFe.det);

  const items: ExtractedExpenseItem[] = [];
  for (const d of detList) {
    const prod = normalizeProd(d.prod);
    if (!prod) continue;
    const { cfop, csosn } = extractCfopAndCsosnFromDet(d);
    const productName = str(prod.xProd) ?? "Item";
    const quantity = Math.max(0.0001, num(prod.qCom ?? prod.qTrib));
    const unitValue = num(prod.vUnCom ?? prod.vUnTrib);
    const lineTotal = num(prod.vProd);
    const uCom = str(prod.uCom);
    const uTrib = str(prod.uTrib);
    const ncm = str(prod.NCM ?? prod.ncm);
    const ean =
      str(prod.cEAN as string | undefined) ??
      str(prod.cEANTrib as string | undefined);
    const productCode = str(prod.cProd);
    items.push({
      productName,
      quantity,
      unitValue,
      lineTotal: lineTotal > 0 ? lineTotal : quantity * unitValue,
      productCode,
      unitCommercial: uCom,
      unitTax: uTrib && uCom && uTrib !== uCom ? uTrib : null,
      ncm,
      cfop,
      csosn,
      ean: ean && ean !== "SEM GTIN" ? ean : null,
    });
  }

  if (items.length === 0) {
    if (totalAmount > 0) {
      items.push({
        productName: "Itens da NF-e (detalhes não extraídos do XML)",
        quantity: 1,
        unitValue: totalAmount,
        lineTotal: totalAmount,
        productCode: null,
        unitCommercial: null,
        unitTax: null,
        ncm: null,
        ean: null,
      });
    } else {
      return null;
    }
  }

  const itemsSum = items.reduce((acc, it) => {
    const lt = Number(it.lineTotal ?? 0);
    if (Number.isFinite(lt) && lt > 0) return acc + lt;
    const q = Number(it.quantity ?? 0);
    const uv = Number(it.unitValue ?? 0);
    if (Number.isFinite(q) && Number.isFinite(uv)) return acc + q * uv;
    return acc;
  }, 0);
  const roundedSum = Math.round(itemsSum * 100) / 100;
  if (!(totalAmount > 0) && roundedSum > 0) {
    totalAmount = roundedSum;
  }

  return {
    validDocument: true,
    invalidReason: undefined,
    documentKind: "nota_fiscal",
    supplierName,
    supplierDocument,
    invoiceNumber,
    invoiceSeries,
    nfeAccessKey: nfeAccessKey ?? null,
    emissionDate: emissionDate ?? null,
    totalAmount: totalAmount > 0 ? totalAmount : roundedSum > 0 ? roundedSum : null,
    items,
    notes: "Importado de XML NF-e",
    likelyNotEffectivePurchase: false,
    likelyNotPurchaseReason: null,
  };
}

/** Totais e bases na tag `ICMSTot` (NF-e / nfeProc). */
export type NfeXmlTaxTotals = {
  vBC: number | null;
  vICMS: number | null;
  vICMSDeson: number | null;
  vFCP: number | null;
  vBCST: number | null;
  vST: number | null;
  vFCPST: number | null;
  vProd: number | null;
  vFrete: number | null;
  vSeg: number | null;
  vDesc: number | null;
  vII: number | null;
  vIPI: number | null;
  vIPIDevol: number | null;
  vPIS: number | null;
  vCOFINS: number | null;
  vOutro: number | null;
  vNF: number | null;
  vTotTrib: number | null;
};

function taxField(icmsTot: Record<string, unknown> | undefined, key: string): number | null {
  if (!icmsTot) return null;
  const raw = icmsTot[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = num(raw);
  return Number.isFinite(n) ? n : null;
}

/** Extrai totais de impostos do bloco `total/ICMSTot` (um parse). */
export function extractNfeTaxTotalsFromXml(xmlText: string): NfeXmlTaxTotals | null {
  const trimmed = stripBom(xmlText);
  if (!trimmed.startsWith("<")) return null;

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  let root: Record<string, unknown>;
  try {
    root = parser.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const nfeProc = root.nfeProc as Record<string, unknown> | undefined;
  const nfeRoot = pickNFeRoot(nfeProc?.NFe ?? root.NFe);
  const infNFe = pickInfNFe(nfeRoot?.infNFe);
  if (!infNFe || typeof infNFe !== "object") return null;

  const total = infNFe.total as Record<string, unknown> | undefined;
  const icmsRaw = total?.ICMSTot;
  const icmsTot = (
    Array.isArray(icmsRaw) ? icmsRaw[0] : icmsRaw
  ) as Record<string, unknown> | undefined;
  if (!icmsTot || typeof icmsTot !== "object") return null;

  return {
    vBC: taxField(icmsTot, "vBC"),
    vICMS: taxField(icmsTot, "vICMS"),
    vICMSDeson: taxField(icmsTot, "vICMSDeson"),
    vFCP: taxField(icmsTot, "vFCP"),
    vBCST: taxField(icmsTot, "vBCST"),
    vST: taxField(icmsTot, "vST"),
    vFCPST: taxField(icmsTot, "vFCPST"),
    vProd: taxField(icmsTot, "vProd"),
    vFrete: taxField(icmsTot, "vFrete"),
    vSeg: taxField(icmsTot, "vSeg"),
    vDesc: taxField(icmsTot, "vDesc"),
    vII: taxField(icmsTot, "vII"),
    vIPI: taxField(icmsTot, "vIPI"),
    vIPIDevol: taxField(icmsTot, "vIPIDevol"),
    vPIS: taxField(icmsTot, "vPIS"),
    vCOFINS: taxField(icmsTot, "vCOFINS"),
    vOutro: taxField(icmsTot, "vOutro"),
    vNF: taxField(icmsTot, "vNF"),
    vTotTrib: taxField(icmsTot, "vTotTrib"),
  };
}

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

/** Aceita nfeProc, NFe sem wrapper, ou XML com namespace */
export function parseNfeXmlToExtracted(xmlText: string): ExtractedDocumentResult | null {
  const trimmed = xmlText.trim();
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
  const nfeRoot = (nfeProc?.NFe ?? root.NFe) as Record<string, unknown> | undefined;
  const infNFe = nfeRoot?.infNFe as Record<string, unknown> | undefined;
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

  let detRaw = infNFe.det;
  if (!detRaw) return null;
  const detList = Array.isArray(detRaw) ? detRaw : [detRaw];

  const items: ExtractedExpenseItem[] = [];
  for (const det of detList) {
    const d = det as Record<string, unknown>;
    const prod = d.prod as Record<string, unknown> | undefined;
    if (!prod) continue;
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
      ean: ean && ean !== "SEM GTIN" ? ean : null,
    });
  }

  if (items.length === 0) {
    return null;
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

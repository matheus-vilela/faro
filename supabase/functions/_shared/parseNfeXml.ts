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

  const total = infNFe.total as Record<string, unknown> | undefined;
  const icmsTot = total?.ICMSTot as Record<string, unknown> | undefined;
  const totalAmount = num(icmsTot?.vNF);

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
    items.push({
      productName,
      quantity,
      unitValue,
      lineTotal: lineTotal > 0 ? lineTotal : quantity * unitValue,
      unitCommercial: uCom,
      unitTax: uTrib && uCom && uTrib !== uCom ? uTrib : null,
      ncm,
      ean: ean && ean !== "SEM GTIN" ? ean : null,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return {
    validDocument: true,
    invalidReason: undefined,
    documentKind: "nota_fiscal",
    supplierName,
    supplierDocument,
    invoiceNumber,
    invoiceSeries,
    totalAmount: totalAmount > 0 ? totalAmount : null,
    items,
    notes: "Importado de XML NF-e",
    likelyNotEffectivePurchase: false,
    likelyNotPurchaseReason: null,
  };
}

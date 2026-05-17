/**
 * Agrega dados para log/interpretação de XML NF-e em staging (fornecedor, total, itens, impostos, cobrança).
 */
import type { ExtractedDocumentResult } from "./openaiExpense.ts";
import { extractDuplicatesFromNfeXml } from "./extractDupFromNfeXml.ts";
import {
  extractNfeTaxTotalsFromXml,
  parseNfeXmlToExtracted,
  type NfeXmlTaxTotals,
} from "./parseNfeXml.ts";

export type StagingNfeInterpretLog = {
  chave_nfe: string;
  staging_id?: string;
  fornecedor: {
    nome: string | null;
    documento: string | null;
  };
  valor_total_nota: number | null;
  numero_nota: string | null;
  serie: string | null;
  data_emissao: string | null;
  produtos: Array<{
    nome: string;
    codigo: string | null;
    ncm: string | null;
    cfop: string | null;
    csosn: string | null;
    ean: string | null;
    quantidade: number;
    valor_unitario: number;
    valor_total_linha: number;
    unidade_comercial: string | null;
  }>;
  impostos: NfeXmlTaxTotals | null;
  cobranca_boletos: Array<{
    numero_duplicata: string | null;
    vencimento: string;
    valor: number;
  }>;
  parse_ok: boolean;
  parse_erro?: string;
};

function buildFromExtracted(
  chaveNfe: string,
  stagingId: string | undefined,
  extracted: ExtractedDocumentResult,
  taxes: NfeXmlTaxTotals | null,
  dups: ReturnType<typeof extractDuplicatesFromNfeXml>,
): StagingNfeInterpretLog {
  return {
    chave_nfe: chaveNfe,
    staging_id: stagingId,
    fornecedor: {
      nome: extracted.supplierName ?? null,
      documento: extracted.supplierDocument ?? null,
    },
    valor_total_nota: extracted.totalAmount ?? null,
    numero_nota: extracted.invoiceNumber ?? null,
    serie: extracted.invoiceSeries ?? null,
    data_emissao: extracted.emissionDate ?? null,
    produtos: (extracted.items ?? []).map((it) => ({
      nome: it.productName,
      codigo: it.productCode ?? null,
      ncm: it.ncm ?? null,
      cfop: it.cfop ?? null,
      csosn: it.csosn ?? null,
      ean: it.ean ?? null,
      quantidade: it.quantity,
      valor_unitario: it.unitValue,
      valor_total_linha: it.lineTotal,
      unidade_comercial: it.unitCommercial ?? null,
    })),
    impostos: taxes,
    cobranca_boletos: dups.map((d) => ({
      numero_duplicata: d.nDup,
      vencimento: d.dueDateYmd,
      valor: d.amount,
    })),
    parse_ok: true,
  };
}

/** Interpreta o XML de uma linha de staging e devolve objeto pronto para `console.log`. */
export function interpretStagingNfeXmlForLog(
  chaveNfe: string,
  xmlContent: string | null | undefined,
  stagingId?: string,
): StagingNfeInterpretLog {
  const chave = String(chaveNfe ?? "").replace(/\D/g, "");
  if (!xmlContent || !String(xmlContent).trim().startsWith("<")) {
    return {
      chave_nfe: chave || chaveNfe,
      staging_id: stagingId,
      fornecedor: { nome: null, documento: null },
      valor_total_nota: null,
      numero_nota: null,
      serie: null,
      data_emissao: null,
      produtos: [],
      impostos: null,
      cobranca_boletos: [],
      parse_ok: false,
      parse_erro: "sem_xml_ou_corpo_invalido",
    };
  }

  const extracted = parseNfeXmlToExtracted(xmlContent);
  const taxes = extractNfeTaxTotalsFromXml(xmlContent);
  const dups = extractDuplicatesFromNfeXml(xmlContent);

  if (!extracted) {
    return {
      chave_nfe: chave || chaveNfe,
      staging_id: stagingId,
      fornecedor: { nome: null, documento: null },
      valor_total_nota: null,
      numero_nota: null,
      serie: null,
      data_emissao: null,
      produtos: [],
      impostos: taxes,
      cobranca_boletos: dups.map((d) => ({
        numero_duplicata: d.nDup,
        vencimento: d.dueDateYmd,
        valor: d.amount,
      })),
      parse_ok: false,
      parse_erro: "parseNfeXmlToExtracted_null",
    };
  }

  return buildFromExtracted(chave || chaveNfe, stagingId, extracted, taxes, dups);
}

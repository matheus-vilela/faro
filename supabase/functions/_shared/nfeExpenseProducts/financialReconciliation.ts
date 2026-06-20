import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import type { FinancialReconciliationOutcome } from "./types.ts";

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export type IcmsTotalsSlice = {
  vNF: number | null;
  /** Valores positivos como no XML (frete). */
  vFrete: number | null;
  /** Desconto global (positivo no XML). */
  vDesc: number | null;
  vSeg: number | null;
  vOutro: number | null;
};

/**
 * Extrai ICMSTot do XML NF-e (wrapper nfeProc ou NFe cru).
 */
export function extractIcmsTotalsFromNfeXml(xmlText: string): IcmsTotalsSlice | null {
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
  const total = infNFe?.total as Record<string, unknown> | undefined;
  const icmsRaw = total?.ICMSTot;
  const icmsTot = (
    Array.isArray(icmsRaw) ? icmsRaw[0] : icmsRaw
  ) as Record<string, unknown> | undefined;
  if (!icmsTot || typeof icmsTot !== "object") return null;
  const vNFraw = num(icmsTot.vNF);
  const vNF = vNFraw > 0 ? Math.round(vNFraw * 100) / 100 : null;
  const vf = num(icmsTot.vFrete);
  const vd = num(icmsTot.vDesc);
  const vs = num(icmsTot.vSeg);
  const vo = num(icmsTot.vOutro);
  return {
    vNF,
    vFrete: vf > 0 ? Math.round(vf * 100) / 100 : null,
    vDesc: vd > 0 ? Math.round(vd * 100) / 100 : null,
    vSeg: vs > 0 ? Math.round(vs * 100) / 100 : null,
    vOutro: vo > 0 ? Math.round(vo * 100) / 100 : null,
  };
}

function sumLines(items: ExtractedExpenseItem[]): number {
  let s = 0;
  for (const it of items) {
    const lt = Number(it.lineTotal ?? 0);
    if (Number.isFinite(lt) && lt > 0) {
      s += lt;
      continue;
    }
    const q = Number(it.quantity ?? 0);
    const uv = Number(it.unitValue ?? 0);
    if (Number.isFinite(q) && Number.isFinite(uv)) s += q * uv;
  }
  return Math.round(s * 100) / 100;
}

const EPS = 0.02;

/**
 * Compara total da nota (`vNF`) à soma das linhas e acessórios ICMSTot (frete, desconto, outros).
 */
export function reconcileNfeFinancials(params: {
  items: ExtractedExpenseItem[];
  expenseDocumentTotal: number | null | undefined;
  xmlText: string | null;
}): FinancialReconciliationOutcome {
  const sum_lines = sumLines(params.items);
  const icms = params.xmlText ? extractIcmsTotalsFromNfeXml(params.xmlText) : null;
  const document_total =
    icms?.vNF != null && icms.vNF > 0
      ? icms.vNF
      : (params.expenseDocumentTotal != null &&
          Number.isFinite(Number(params.expenseDocumentTotal)) &&
          Number(params.expenseDocumentTotal) > 0)
        ? Math.round(Number(params.expenseDocumentTotal) * 100) / 100
        : sum_lines > 0
          ? sum_lines
          : null;

  const gaps: FinancialReconciliationOutcome["gaps"] = {};
  if (icms?.vFrete != null) gaps.frete = icms.vFrete;
  if (icms?.vDesc != null) gaps.discount = icms.vDesc;
  const other: Record<string, number> = {};
  if (icms?.vOutro != null && icms.vOutro > 0) {
    other.vOutro = icms.vOutro;
  }
  if (Object.keys(other).length) gaps.other = other;

  if (document_total == null) {
    return {
      document_total: null,
      sum_lines,
      gaps,
      status: "PARTIAL_UNKNOWN",
      expense_update: {
        divergence_reason: "Total do documento indisponível para reconciliação.",
        financial_reconciliation_json: {
          icms_tot: icms,
          sum_lines,
        },
      },
    };
  }

  const adjustedSum =
    sum_lines +
    (gaps.frete ?? 0) -
    (gaps.discount ?? 0) +
    Object.values(gaps.other ?? {}).reduce((a, b) => a + b, 0);

  const delta = Math.round((document_total - adjustedSum) * 100) / 100;
  const ok = Math.abs(delta) <= EPS;

  const snapshot = {
    icms_tot: icms,
    sum_lines,
    document_total,
    adjusted_sum_components: {
      lines: sum_lines,
      plus_frete: gaps.frete ?? 0,
      minus_discount: gaps.discount ?? 0,
      plus_other: Object.values(gaps.other ?? {}).reduce((a, b) => a + b, 0),
    },
    delta,
  };

  if (ok) {
    return {
      document_total,
      sum_lines,
      gaps,
      status: "OK",
      expense_update: {
        divergence_reason: undefined,
        financial_reconciliation_json: snapshot,
      },
    };
  }

  return {
    document_total,
    sum_lines,
    gaps,
    status: "DIVERGENT",
    expense_update: {
      divergence_reason:
        `Totais: nota ${document_total} vs componentes (${adjustedSum.toFixed(
          2,
        )}); delta ${delta.toFixed(2)}.`,
      financial_reconciliation_json: snapshot,
    },
  };
}

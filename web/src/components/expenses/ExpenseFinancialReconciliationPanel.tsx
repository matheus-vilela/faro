import {
  ICMS_TOT_COLUMN_ORDER,
  TotalsMatrixTable,
  type TotalsMatrixRow,
} from "@/components/nfe/TotalsMatrixTable";
import type { ReactNode } from "react";

const ICMS_TOT_LABELS: Record<string, string> = {
  vBC: "Base de cálculo ICMS",
  vICMS: "ICMS",
  vICMSDeson: "ICMS desonerado",
  vFCP: "FCP",
  vBCST: "Base de cálculo ICMS ST",
  vST: "ICMS ST",
  vFCPST: "FCP ST",
  vProd: "Total produtos / serviços",
  vFrete: "Frete",
  vSeg: "Seguro",
  vDesc: "Desconto",
  vII: "Imposto de importação (II)",
  vIPI: "IPI",
  vIPIDevol: "IPI devolvido",
  vPIS: "PIS",
  vCOFINS: "COFINS",
  vOutro: "Outras despesas acessórias",
  vNF: "Valor total da NF (vNF)",
  vTotTrib: "Valor aproximado total de tributos",
};

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function ExpenseFinancialReconciliationPanel({
  data,
  formatCurrency,
}: {
  data: Record<string, unknown> | null | undefined;
  formatCurrency: (v: number) => string;
}): ReactNode {
  if (!data || typeof data !== "object") return null;

  const icms = data.icms_tot;
  const icmsRows: TotalsMatrixRow[] = [];
  if (icms && typeof icms === "object" && !Array.isArray(icms)) {
    for (const [key, raw] of Object.entries(icms as Record<string, unknown>)) {
      const n = numOrNull(raw);
      if (n == null) continue;
      icmsRows.push({
        key,
        label: ICMS_TOT_LABELS[key] ?? key,
        value: n,
      });
    }
  }

  const valorTop = numOrNull(data.valor_total_nota);
  const docTotal = numOrNull(data.document_total);
  const sumLinesRoot = numOrNull(data.sum_lines);
  const delta = numOrNull(data.delta);
  const adj = data.adjusted_sum_components;
  const adjObj =
    adj && typeof adj === "object" && !Array.isArray(adj)
      ? (adj as Record<string, unknown>)
      : null;
  const linesFromAdj = adjObj ? numOrNull(adjObj.lines) : null;
  const plusFrete = adjObj ? numOrNull(adjObj.plus_frete) : null;
  const minusDiscount = adjObj ? numOrNull(adjObj.minus_discount) : null;
  const plusOther = adjObj ? numOrNull(adjObj.plus_other) : null;

  const lineSum = sumLinesRoot ?? linesFromAdj;

  const hasConferenceBody =
    (lineSum != null && lineSum !== 0) ||
    (plusFrete != null && plusFrete !== 0) ||
    (minusDiscount != null && minusDiscount !== 0) ||
    (plusOther != null && plusOther !== 0) ||
    (docTotal != null && docTotal !== 0) ||
    (delta != null && delta !== 0);

  const hasIcms = icmsRows.length > 0;
  const hasTop = valorTop != null || docTotal != null;
  const source = String(data.source ?? "").trim();
  const chave = String(data.chave_nfe ?? "").trim();

  const stagingAdjusted =
    data.document_total_adjusted === true ||
    data.document_total_adjusted === "true";

  if (
    !hasIcms &&
    !hasConferenceBody &&
    !hasTop &&
    !source &&
    !chave &&
    !stagingAdjusted
  )
    return null;

  const conferenceRows: TotalsMatrixRow[] = [];
  if (lineSum != null && lineSum !== 0) {
    conferenceRows.push({
      key: "sum_lines",
      label: "Soma das linhas",
      value: lineSum,
    });
  }
  if (plusFrete != null && plusFrete !== 0) {
    conferenceRows.push({
      key: "plus_frete",
      label: "(+) Frete",
      value: plusFrete,
    });
  }
  if (minusDiscount != null && minusDiscount !== 0) {
    conferenceRows.push({
      key: "minus_discount",
      label: "(−) Desconto global (abatimento)",
      value: -Math.abs(minusDiscount),
    });
  }
  if (plusOther != null && plusOther !== 0) {
    conferenceRows.push({
      key: "plus_other",
      label: "(+) Outros (XML)",
      value: plusOther,
    });
  }
  if (docTotal != null && docTotal !== 0) {
    conferenceRows.push({
      key: "document_total",
      label: "Total da nota (vNF)",
      value: docTotal,
    });
  }
  if (delta != null && delta !== 0) {
    conferenceRows.push({
      key: "delta",
      label: "Diferença (nota − componentes)",
      value: delta,
    });
  }

  return (
    <div className="space-y-4">
      {hasIcms ? (
        <TotalsMatrixTable
          title="ICMSTot (totais da nota)"
          rows={icmsRows}
          formatValue={formatCurrency}
          columnOrder={ICMS_TOT_COLUMN_ORDER}
        />
      ) : null}

      {hasConferenceBody ? (
        <TotalsMatrixTable
          title="Conferência (soma vs total)"
          rows={conferenceRows}
          formatValue={formatCurrency}
        />
      ) : null}
    </div>
  );
}

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

/** Ordem de relevância para listar primeiro totais “óbvios” da nota. */
const ICMS_ORDER: string[] = [
  "vNF",
  "vProd",
  "vDesc",
  "vFrete",
  "vSeg",
  "vOutro",
  "vIPI",
  "vPIS",
  "vCOFINS",
  "vII",
  "vICMS",
  "vST",
  "vBC",
  "vBCST",
  "vICMSDeson",
  "vFCP",
  "vFCPST",
  "vIPIDevol",
  "vTotTrib",
];

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function Row({
  label,
  value,
  formatCurrency,
}: {
  label: string;
  value: number;
  formatCurrency: (v: number) => string;
}) {
  return (
    <div className="flex justify-between gap-3 text-sm py-0.5 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

function sortIcmsRows(rows: Array<{ key: string; label: string; value: number }>) {
  const rank = (k: string) => {
    const i = ICMS_ORDER.indexOf(k);
    return i === -1 ? 1000 + k.charCodeAt(0) : i;
  };
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "pt-BR"));
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
  const icmsRows: Array<{ key: string; label: string; value: number }> = [];
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
    data.document_total_adjusted === true || data.document_total_adjusted === "true";
  const beforeAdj = numOrNull(data.document_total_before);
  const afterAdj = numOrNull(data.document_total_after);

  if (!hasIcms && !hasConferenceBody && !hasTop && !source && !chave && !stagingAdjusted)
    return null;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Impostos e totais (NF-e)</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Valores do XML (ICMSTot) e, quando houver, a conferência entre soma das linhas e total da
          nota.
        </p>
      </div>

      {stagingAdjusted && (beforeAdj != null || afterAdj != null) && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs space-y-1">
          <p className="font-medium text-foreground">Total da despesa alinhado ao XML (vNF)</p>
          <p className="text-muted-foreground">
            O total gravado na despesa foi definido a partir do <span className="font-medium">vNF</span> do
            bloco ICMSTot da NF-e, quando este valor difere do total vindo só da interpretação das linhas.
          </p>
          {beforeAdj != null && (
            <p>
              <span className="text-muted-foreground">Total interpretado (antes):</span>{" "}
              <span className="font-medium tabular-nums">{formatCurrency(beforeAdj)}</span>
            </p>
          )}
          {afterAdj != null && (
            <p>
              <span className="text-muted-foreground">Total aplicado (vNF):</span>{" "}
              <span className="font-medium tabular-nums">{formatCurrency(afterAdj)}</span>
            </p>
          )}
        </div>
      )}

      {(hasTop || source || chave) && (
        <div className="text-xs text-muted-foreground space-y-1">
          {valorTop != null && (
            <p>
              <span className="text-muted-foreground">Total na interpretação:</span>{" "}
              <span className="font-medium text-foreground">{formatCurrency(valorTop)}</span>
            </p>
          )}
          {docTotal != null && docTotal !== valorTop && (
            <p>
              <span className="text-muted-foreground">Total do documento (conferência):</span>{" "}
              <span className="font-medium text-foreground">{formatCurrency(docTotal)}</span>
            </p>
          )}
          {source && (
            <p>
              Origem: <span className="font-mono text-foreground">{source}</span>
            </p>
          )}
          {chave && (
            <p className="break-all">
              Chave NF-e: <span className="font-mono text-foreground">{chave}</span>
            </p>
          )}
        </div>
      )}

      {hasIcms && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            ICMSTot (XML)
          </p>
          <div className="rounded-md bg-muted/30 px-3 py-2 space-y-0">
            {sortIcmsRows(icmsRows).map((r) => (
              <Row key={r.key} label={r.label} value={r.value} formatCurrency={formatCurrency} />
            ))}
          </div>
        </div>
      )}

      {hasConferenceBody && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Conferência (soma vs total)
          </p>
          <div className="rounded-md bg-muted/30 px-3 py-2 space-y-0">
            {lineSum != null && lineSum !== 0 && (
              <Row label="Soma das linhas" value={lineSum} formatCurrency={formatCurrency} />
            )}
            {plusFrete != null && plusFrete !== 0 && (
              <Row label="(+) Frete" value={plusFrete} formatCurrency={formatCurrency} />
            )}
            {minusDiscount != null && minusDiscount !== 0 && (
              <Row
                label="(−) Desconto global (abatimento)"
                value={-Math.abs(minusDiscount)}
                formatCurrency={formatCurrency}
              />
            )}
            {plusOther != null && plusOther !== 0 && (
              <Row label="(+) Outros (XML)" value={plusOther} formatCurrency={formatCurrency} />
            )}
            {docTotal != null && docTotal !== 0 && (
              <Row label="Total da nota (vNF)" value={docTotal} formatCurrency={formatCurrency} />
            )}
            {delta != null && delta !== 0 && (
              <Row
                label="Diferença (nota − componentes)"
                value={delta}
                formatCurrency={formatCurrency}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

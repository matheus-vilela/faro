/** Ordem usual dos campos ICMSTot na NF-e. */
export const ICMS_TOT_COLUMN_ORDER = [
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
] as const;

export type TotalsMatrixRow = {
  key: string;
  label: string;
  value: number;
};

function sortRows(
  rows: TotalsMatrixRow[],
  order?: readonly string[],
): TotalsMatrixRow[] {
  if (!order?.length) return rows;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? 1000 + k.charCodeAt(0) : i;
  };
  return [...rows].sort(
    (a, b) =>
      rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "pt-BR"),
  );
}

export function TotalsMatrixTable({
  title,
  rows,
  formatValue,
  columnOrder,
}: {
  title?: string;
  rows: TotalsMatrixRow[];
  formatValue: (v: number) => string;
  columnOrder?: readonly string[];
}) {
  if (rows.length === 0) return null;
  const sorted = sortRows(rows, columnOrder);

  return (
    <div className="space-y-2">
      {title ? (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-max caption-bottom border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 min-w-[3.5rem] bg-muted/50 p-2" />
              {sorted.map((r) => (
                <th
                  key={r.key}
                  className="min-w-[5.5rem] max-w-[9rem] p-2 text-center text-xs font-medium leading-snug text-foreground"
                  title={r.label}
                >
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap bg-muted/30 p-2 text-left text-xs font-medium text-muted-foreground"
              >
                Tag
              </th>
              {sorted.map((r) => (
                <td
                  key={r.key}
                  className="p-2 text-center font-mono text-xs text-muted-foreground"
                >
                  {r.key}
                </td>
              ))}
            </tr>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap bg-muted/30 p-2 text-left text-xs font-medium text-muted-foreground"
              >
                Valor
              </th>
              {sorted.map((r) => (
                <td
                  key={r.key}
                  className="whitespace-nowrap p-2 text-center font-mono text-xs font-medium tabular-nums"
                >
                  {formatValue(r.value)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

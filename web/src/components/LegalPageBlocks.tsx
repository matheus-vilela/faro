import { cn } from "@/lib/utils";

export function LegalPolicyTable({
  headers,
  rows,
  minWidthClass = "min-w-[36rem]",
}: {
  headers: string[];
  rows: string[][];
  /** Largura mínima da tabela (ex.: planos com 4 colunas). */
  minWidthClass?: string;
}) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table
        className={cn(
          "w-full border-collapse text-left text-sm",
          minWidthClass,
        )}
      >
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 font-semibold text-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-border/80 last:border-0">
              {cells.map((c, j) => (
                <td
                  key={j}
                  className="px-3 py-2 align-top text-muted-foreground [&_strong]:text-foreground"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalH2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 scroll-mt-4 border-b border-border/60 pb-2 font-display text-base font-semibold tracking-tight text-foreground first:mt-0 sm:text-lg">
      {children}
    </h2>
  );
}

export function LegalH3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 font-semibold text-foreground">{children}</h3>
  );
}

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBrl } from "@/lib/dre/formatBrl";
import type { BudgetComparisonResult } from "@/lib/budget/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function BudgetChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const byKey = Object.fromEntries(
    payload.map((p) => [p.dataKey, p.value]),
  ) as Record<string, number>;

  const budgeted = byKey.budgeted ?? 0;
  const actual = byKey.actual ?? 0;
  const variance = actual - budgeted;

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>
          Orçado:{" "}
          <span className="font-medium text-foreground">
            {formatBrl(budgeted)}
          </span>
        </p>
        <p>
          Realizado:{" "}
          <span className="font-medium text-rose-700 dark:text-rose-400">
            {formatBrl(actual)}
          </span>
        </p>
        <p>
          Desvio:{" "}
          <span
            className={
              variance > 0
                ? "font-medium text-red-600 dark:text-red-400"
                : "font-medium text-emerald-600 dark:text-emerald-400"
            }
          >
            {variance >= 0 ? "+" : ""}
            {formatBrl(variance)}
          </span>
        </p>
      </div>
    </div>
  );
}

export function BudgetComparisonChart({
  chartRows,
  loading,
}: {
  chartRows: BudgetComparisonResult["chartRows"];
  loading: boolean;
}) {
  const data = chartRows.map((row) => ({
    name:
      row.name.length > 18 ? `${row.name.slice(0, 16)}…` : row.name,
    fullName: row.name,
    budgeted: row.budgeted,
    actual: row.actual,
  }));

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Maiores desvios</CardTitle>
        <CardDescription>
          Comparação orçado vs. realizado nas categorias com maior diferença.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full sm:h-[360px]" />
        ) : data.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground sm:h-[360px]">
            Cadastre orçamentos ou aguarde movimentação para ver o gráfico.
          </div>
        ) : (
          <div className="h-[280px] w-full sm:h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    Number(v).toLocaleString("pt-BR", {
                      notation: "compact",
                      compactDisplay: "short",
                    })
                  }
                />
                <Tooltip content={<BudgetChartTooltip />} />
                <Legend />
                <Bar
                  dataKey="budgeted"
                  name="Orçado"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="actual"
                  name="Realizado"
                  fill="var(--chart-5)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

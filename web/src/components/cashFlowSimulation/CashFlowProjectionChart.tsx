import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBrl } from "@/lib/dre/formatBrl";
import type { PeriodBucket } from "@/lib/cashFlowSimulation/types";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartRow = {
  label: string;
  inflows: number;
  outflows: number;
  balance: number;
  baseBalance?: number;
};

function CashFlowTooltip({
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

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>
          Entradas:{" "}
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            {formatBrl(byKey.inflows ?? 0)}
          </span>
        </p>
        <p>
          Saídas:{" "}
          <span className="font-medium text-red-600 dark:text-red-400">
            {formatBrl(byKey.outflows ?? 0)}
          </span>
        </p>
        <p>
          Saldo:{" "}
          <span className="font-medium text-foreground">
            {formatBrl(byKey.balance ?? 0)}
          </span>
        </p>
        {byKey.baseBalance != null ? (
          <p>
            Saldo Base:{" "}
            <span className="font-medium text-foreground">
              {formatBrl(byKey.baseBalance)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CashFlowProjectionChart({
  buckets,
  baseBuckets,
  loading,
}: {
  buckets: PeriodBucket[];
  baseBuckets?: PeriodBucket[] | null;
  loading: boolean;
}) {
  const showBaseLine = Boolean(
    baseBuckets && baseBuckets.length === buckets.length,
  );
  const data: ChartRow[] = buckets.map((b, i) => {
    const row: ChartRow = {
      label: `Sem ${i + 1}`,
      inflows: b.inflows,
      outflows: b.outflows,
      balance: b.runningBalance,
    };
    if (showBaseLine && baseBuckets) {
      row.baseBalance = baseBuckets[i]?.runningBalance ?? 0;
    }
    return row;
  });

  const hasNegativeBalance = buckets.some((b) => b.runningBalance < 0);

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Projeção de caixa</CardTitle>
        <CardDescription>
          Barras: entradas e saídas por semana. Linha: saldo acumulado
          {showBaseLine ? ". Tracejado: saldo no cenário Base" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full sm:h-[360px]" />
        ) : buckets.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground sm:h-[360px]">
            Nenhum período para exibir.
          </div>
        ) : (
        <div className="h-[280px] w-full sm:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1000
                    ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`
                    : String(v)
                }
                width={48}
              />
              <Tooltip content={<CashFlowTooltip />} />
              {hasNegativeBalance ? (
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
              ) : null}
              <Bar
                dataKey="inflows"
                name="Entradas"
                fill="var(--chart-2, #10b981)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="outflows"
                name="Saídas"
                fill="var(--chart-5, #ef4444)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Line
                type="monotone"
                dataKey="balance"
                name="Saldo"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--primary)" }}
              />
              {showBaseLine ? (
                <Line
                  type="monotone"
                  dataKey="baseBalance"
                  name="Saldo Base"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.75}
                  strokeDasharray="6 4"
                  dot={false}
                  legendType="none"
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

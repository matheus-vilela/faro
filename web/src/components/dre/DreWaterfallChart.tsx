import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DreComputed } from "@/lib/dre/computeDre";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";

type WfStep = {
  name: string;
  value: number;
  kind: "start" | "down" | "end";
  fill: string;
};

function buildSteps(computed: DreComputed): WfStep[] {
  const receita = computed.vendasLiquidas || computed.vendasBrutas;
  const opex =
    computed.despesasVariaveis +
    computed.despesasFixas +
    computed.impostos;
  const outras = computed.resultadoFinanceiroDespesas;
  return [
    { name: "Receita", value: receita, kind: "start", fill: "bg-emerald-500" },
    { name: "CMV", value: -computed.cmv, kind: "down", fill: "bg-violet-500" },
    { name: "Despesas", value: -opex, kind: "down", fill: "bg-amber-500" },
    { name: "Outras", value: -outras, kind: "down", fill: "bg-pink-500" },
    {
      name: "Resultado",
      value: computed.lucroLiquido,
      kind: "end",
      fill: "bg-primary",
    },
  ];
}

export function DreWaterfallChart({
  computed,
  periodLabel,
  loading,
}: {
  computed: DreComputed | null;
  periodLabel: string;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-[380px] w-full rounded-xl" />;
  }
  if (!computed) {
    return (
      <Card className="border-border/80 shadow-sm">
        <CardContent className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
          Sem dados para a cascata neste período.
        </CardContent>
      </Card>
    );
  }

  const steps = buildSteps(computed);
  const maxAbs = Math.max(
    ...steps.map((s) => Math.abs(s.value)),
    computed.vendasBrutas,
    1,
  );
  const geomMax = maxAbs * 1.35;

  let cum = 0;
  const bars = steps.map((st) => {
    let top: number;
    let bot: number;
    if (st.kind === "start") {
      top = st.value;
      bot = 0;
      cum = st.value;
    } else if (st.kind === "end") {
      top = Math.max(st.value, 0);
      bot = Math.min(st.value, 0);
    } else {
      const prev = cum;
      cum = cum + st.value;
      top = Math.max(prev, cum);
      bot = Math.min(prev, cum);
    }
    const bottomPct = (bot / geomMax) * 100;
    const heightPct = Math.max(0.4, ((top - bot) / geomMax) * 100);
    const pctOfRev =
      maxAbs > 0 ? Math.round((Math.abs(st.value) / maxAbs) * 100) : 0;
    return {
      ...st,
      bottomPct,
      heightPct,
      pctLabel:
        st.kind === "start"
          ? "100% da receita"
          : st.kind === "end"
            ? `${pctOfRev}% da receita`
            : `−${pctOfRev}%`,
    };
  });

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Cascata do resultado · {periodLabel}
        </CardTitle>
        <CardDescription>
          Da receita ao que sobra — cada degrau é o que entra ou sai até o
          resultado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-[300px] items-end gap-2 sm:h-[340px] sm:gap-3">
          {bars.map((b) => (
            <div
              key={b.name}
              className="flex h-full min-w-0 flex-1 flex-col items-center"
            >
              <div className="relative w-full flex-1">
                <div
                  className={cn(
                    "absolute left-[12%] right-[12%] min-h-[3px] rounded-md",
                    b.fill,
                  )}
                  style={{
                    bottom: `${b.bottomPct}%`,
                    height: `${b.heightPct}%`,
                  }}
                />
                <div
                  className="absolute left-0 right-0 text-center"
                  style={{
                    bottom: `calc(${b.bottomPct + b.heightPct}% + 6px)`,
                  }}
                >
                  <div
                    className={cn(
                      "text-xs font-bold tabular-nums leading-tight sm:text-sm",
                      b.kind === "down"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {formatBrl(b.value)}
                  </div>
                  <div className="text-[10px] text-muted-foreground sm:text-[11px]">
                    {b.pctLabel}
                  </div>
                </div>
              </div>
              <div className="mt-1 w-full border-t border-border/60 pt-2 text-center text-[11px] text-muted-foreground sm:text-xs">
                {b.name}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

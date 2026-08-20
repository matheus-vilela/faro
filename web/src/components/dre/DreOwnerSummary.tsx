import { FaroTipBand } from "@/components/FaroTipBand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MonthYear } from "@/components/MonthSelector";
import type { DreComputed } from "@/lib/dre/computeDre";
import {
  buildDreInsight,
  estimateBreakEvenDay,
  formatMomDelta,
  momPercent,
} from "@/lib/dre/dreInsight";
import { pontoEquilibrioReceita } from "@/lib/dre/dreIndicators";
import type { ExpenseMixItem } from "@/lib/dre/expenseMix";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";

const MIX_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-slate-500",
  "bg-violet-500",
];

function CascadeLine({
  label,
  amount,
  sub,
  delta,
  tone,
  emphasize,
}: {
  label: string;
  amount: number;
  sub?: string;
  delta?: string | null;
  tone: "receita" | "despesa" | "subtotal" | "total";
  emphasize?: boolean;
}) {
  const amountCls =
    tone === "receita"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "despesa"
        ? "text-rose-700 dark:text-rose-400"
        : tone === "total"
          ? "text-primary"
          : "text-foreground";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5",
        emphasize && "bg-primary/8 ring-1 ring-primary/20",
        tone === "subtotal" && "bg-muted/40",
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm",
            emphasize ? "font-semibold" : "font-medium",
          )}
        >
          {label}
        </p>
        {sub ? (
          <p className="text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("tabular-nums text-sm font-semibold", amountCls)}>
          {tone === "despesa" && amount !== 0 ? `− ${formatBrl(Math.abs(amount))}` : formatBrl(amount)}
        </p>
        {delta ? (
          <p className="text-[11px] tabular-nums text-muted-foreground">{delta}</p>
        ) : null}
      </div>
    </div>
  );
}

export function DreOwnerSummary({
  computed,
  period,
  periodLabel,
  previous,
  expenseMix,
  semCategoriaTotal,
  onClassifyClick,
}: {
  computed: DreComputed;
  period: MonthYear;
  periodLabel: string;
  previous: DreComputed | null;
  expenseMix: ExpenseMixItem[];
  semCategoriaTotal: number;
  onClassifyClick?: () => void;
}) {
  const pe = pontoEquilibrioReceita(computed);
  const beDay = estimateBreakEvenDay(computed, period);
  const opex =
    computed.despesasVariaveis +
    computed.despesasFixas +
    computed.resultadoFinanceiroDespesas;
  const margemPct =
    computed.vendasLiquidas > 0
      ? (computed.lucroLiquido / computed.vendasLiquidas) * 100
      : null;
  const cmvPct =
    computed.vendasLiquidas > 0
      ? (computed.cmv / computed.vendasLiquidas) * 100
      : null;

  const insight = buildDreInsight({
    computed,
    periodLabel,
    previousLucro: previous?.lucroLiquido ?? null,
    semCategoriaTotal,
  });

  const peProgress =
    pe.reason === "ok" && pe.value > 0
      ? Math.min(100, (computed.vendasLiquidas / pe.value) * 100)
      : 0;
  const peSurpassed =
    pe.reason === "ok" && computed.vendasLiquidas >= pe.value;

  return (
    <div className="space-y-4">
      <FaroTipBand>{insight}</FaroTipBand>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Como chegou no lucro</CardTitle>
            <CardDescription>
              Conta simples do resultado em {periodLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <CascadeLine
              label="Receita de vendas"
              amount={computed.vendasLiquidas > 0 ? computed.vendasLiquidas : computed.vendasBrutas}
              tone="receita"
              delta={
                previous
                  ? formatMomDelta(
                      momPercent(
                        computed.vendasLiquidas || computed.vendasBrutas,
                        previous.vendasLiquidas || previous.vendasBrutas,
                      ),
                    )
                  : null
              }
            />
            <CascadeLine
              label="− CMV"
              amount={computed.cmv}
              sub={
                cmvPct != null
                  ? `${cmvPct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da receita`
                  : undefined
              }
              tone="despesa"
              delta={
                previous && previous.vendasLiquidas > 0 && computed.vendasLiquidas > 0
                  ? `${((computed.cmv / computed.vendasLiquidas) * 100 - (previous.cmv / previous.vendasLiquidas) * 100) >= 0 ? "▲" : "▼"} ${Math.abs((computed.cmv / computed.vendasLiquidas) * 100 - (previous.cmv / previous.vendasLiquidas) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}pp`
                  : null
              }
            />
            <CascadeLine
              label="= Lucro bruto"
              amount={computed.lucroBruto}
              tone="subtotal"
            />
            <CascadeLine
              label="− Despesas operacionais"
              amount={opex}
              tone="despesa"
              delta={
                previous
                  ? formatMomDelta(
                      momPercent(
                        opex,
                        previous.despesasVariaveis +
                          previous.despesasFixas +
                          previous.resultadoFinanceiroDespesas,
                      ),
                    )
                  : null
              }
            />
            {semCategoriaTotal > 0 ? (
              <button
                type="button"
                onClick={onClassifyClick}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left transition-colors hover:bg-amber-500/15"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-amber-900 dark:text-amber-200">
                    − Sem classificação
                  </p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
                    Clique para classificar
                  </p>
                </div>
                <p className="shrink-0 tabular-nums text-sm font-semibold text-amber-800 dark:text-amber-200">
                  − {formatBrl(semCategoriaTotal)}
                </p>
              </button>
            ) : null}
            <CascadeLine
              label="= Lucro líquido"
              amount={computed.lucroLiquido - Math.max(0, semCategoriaTotal)}
              sub={
                margemPct != null
                  ? `margem ${margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`
                  : undefined
              }
              tone="total"
              emphasize
              delta={
                previous
                  ? formatMomDelta(
                      momPercent(
                        computed.lucroLiquido - Math.max(0, semCategoriaTotal),
                        previous.lucroLiquido,
                      ),
                    )
                  : null
              }
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle className="text-base">Ponto de equilíbrio</CardTitle>
                {pe.reason === "ok" ? (
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      peSurpassed
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {peSurpassed ? "superado ✓" : "ainda não"}
                  </span>
                ) : null}
              </div>
              <CardDescription>
                {pe.reason === "ok" ? (
                  <>
                    Você precisa de{" "}
                    <strong className="text-foreground">{formatBrl(pe.value)}</strong>{" "}
                    pra pagar as contas. Vendeu{" "}
                    <strong className="text-foreground">
                      {formatBrl(computed.vendasLiquidas)}
                    </strong>
                    .
                  </>
                ) : pe.reason === "no_sales" ? (
                  "Sem vendas líquidas no período — o ponto de equilíbrio não se aplica."
                ) : (
                  "Margem de contribuição insuficiente para calcular o equilíbrio."
                )}
              </CardDescription>
            </CardHeader>
            {pe.reason === "ok" ? (
              <CardContent className="pt-0">
                <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      peSurpassed ? "bg-emerald-500" : "bg-amber-500",
                    )}
                    style={{ width: `${peProgress}%` }}
                  />
                  {peProgress < 100 ? (
                    <span
                      className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-foreground"
                      style={{ left: "100%" }}
                      aria-hidden
                    />
                  ) : null}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                  <span>
                    {beDay != null ? `break-even dia ${beDay}` : "—"}
                  </span>
                  <span
                    className={
                      peSurpassed
                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                        : undefined
                    }
                  >
                    {peSurpassed
                      ? `+ ${formatBrl(computed.vendasLiquidas - pe.value)} acima`
                      : `faltam ${formatBrl(pe.value - computed.vendasLiquidas)}`}
                  </span>
                </div>
              </CardContent>
            ) : null}
          </Card>

          <Card className="flex-1 border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Para onde foi a despesa</CardTitle>
              <CardDescription>
                Distribuição das despesas operacionais por categoria raiz.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {expenseMix.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhuma despesa classificada no período.
                </p>
              ) : (
                expenseMix.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2.5">
                    <span className="w-20 shrink-0 truncate text-xs text-foreground sm:w-24 sm:text-sm">
                      {item.name}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-2 rounded-full",
                          MIX_COLORS[i % MIX_COLORS.length],
                        )}
                        style={{
                          width: `${Math.max(2, Math.min(100, item.percent))}%`,
                        }}
                      />
                    </span>
                    <span className="w-[4.5rem] shrink-0 text-right text-xs font-semibold tabular-nums sm:text-sm">
                      {formatBrl(item.amount)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

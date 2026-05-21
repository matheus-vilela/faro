import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Calculator } from "lucide-react";

export type NfeUnitPricePreviewRow = {
  quantity: number;
  gross: number;
  discount: number;
  ipi_line: number;
  icms_st_line: number;
  fcp_st_line: number;
  outros: number;
  effective_total: number;
  effective_unit_price: number | null;
};

export type NfeUnitPricePreviewLine = {
  line_index: number;
  n_item: string | null;
  c_prod: string | null;
  product_name: string | null;
  cfop: string | null;
  is_bonification: boolean;
  uses_un_tax_base: boolean;
  unit_commercial: string | null;
  unit_tax: string | null;
  row: NfeUnitPricePreviewRow | null;
};

export type NfeUnitPricePreviewNota = {
  v_nf: number | null;
  v_outro_icms_tot?: number;
  soma_coluna_outros?: number;
  soma_bonificacao_5910: number;
  valor_real_nota: number | null;
  soma_total_efetivo_cobrado: number;
};

export type NfeUnitPricePreviewResult = {
  formula: string;
  global_juros_nota: number;
  nota?: NfeUnitPricePreviewNota;
  lines: NfeUnitPricePreviewLine[];
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return BRL.format(v);
}

function formatQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 1_000_000) / 1_000_000;
  return String(r);
}

/** Célula monetária; desconto exibe com sinal negativo. */
function MoneyCell({
  value,
  variant = "default",
}: {
  value: number | null | undefined;
  variant?: "default" | "discount" | "add" | "emphasis";
}) {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const display =
    variant === "discount" ? `− ${formatMoney(value)}` : formatMoney(value);
  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        variant === "discount" && "text-destructive",
        variant === "add" && "text-emerald-700 dark:text-emerald-400",
        variant === "emphasis" && "font-semibold text-primary",
      )}
    >
      {display}
    </span>
  );
}

const TH =
  "p-2 text-xs font-medium text-muted-foreground whitespace-nowrap";
const TD = "p-2 font-mono text-xs tabular-nums";
const TD_RIGHT = cn(TD, "text-right");

export function NfeUnitPriceBreakdownCard({
  preview,
}: {
  preview: NfeUnitPricePreviewResult | null | undefined;
}) {
  if (!preview || preview.lines.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" />
            Valor unitário efetivo
          </CardTitle>
          <CardDescription>
            Não foi possível calcular o breakdown (XML sem linhas de produto legíveis).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4" />
          Valor unitário efetivo (conferência)
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">{preview.formula}</span>
          {preview.global_juros_nota > 0 ? (
            <span className="block text-xs">
              Juros na nota (dup − vNF):{" "}
              <strong className="text-foreground">
                {formatMoney(preview.global_juros_nota)}
              </strong>
              {" "}
              — rateio só em linhas cobradas (exclui CFOP 5910).
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.nota ? (
          <dl className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">vNF (XML)</dt>
              <dd className="font-mono font-medium">
                {formatMoney(preview.nota.v_nf)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Outras despesas (vOutro)
              </dt>
              <dd className="font-mono font-medium">
                {formatMoney(preview.nota.v_outro_icms_tot ?? 0)}
              </dd>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Soma col. Outros:{" "}
                {formatMoney(preview.nota.soma_coluna_outros ?? 0)}
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Bonificação CFOP 5910
              </dt>
              <dd className="font-mono font-medium text-amber-700 dark:text-amber-400">
                {preview.nota.soma_bonificacao_5910 > 0
                  ? `− ${formatMoney(preview.nota.soma_bonificacao_5910)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Valor real da nota
              </dt>
              <dd className="font-mono font-semibold text-primary">
                {formatMoney(preview.nota.valor_real_nota)}
              </dd>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                vNF − soma totais efetivos 5910
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Soma linhas cobradas
              </dt>
              <dd className="font-mono font-medium">
                {formatMoney(preview.nota.soma_total_efetivo_cobrado)}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className={cn(TH, "min-w-[140px]")}>Produto</th>
                <th className={cn(TH, "text-right")}>Qnt</th>
                <th className={cn(TH, "text-right")}>Total bruto</th>
                <th className={cn(TH, "text-right")}>Desconto</th>
                <th className={cn(TH, "text-right")}>IPI</th>
                <th className={cn(TH, "text-right")}>ICMS ST</th>
                <th className={cn(TH, "text-right")}>FCP ST</th>
                <th className={cn(TH, "text-right")}>Outros</th>
                <th className={cn(TH, "text-right")}>Total efetivo</th>
                <th className={cn(TH, "text-right")}>Total / unid</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => {
                const title =
                  line.product_name?.trim() ||
                  line.c_prod?.trim() ||
                  `Linha ${line.line_index + 1}`;
                const r = line.row;

                return (
                  <tr
                    key={line.line_index}
                    className={cn(
                      "border-b border-border/60 align-top",
                      line.is_bonification && "bg-amber-500/5",
                    )}
                  >
                    <td className="p-2 max-w-[220px]">
                      <p className="text-xs font-medium leading-snug">{title}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {line.c_prod ? `cProd ${line.c_prod}` : ""}
                        {line.n_item ? ` · item ${line.n_item}` : ""}
                        {line.cfop ? ` · CFOP ${line.cfop}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {line.is_bonification ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 border-amber-500/50 text-amber-800 dark:text-amber-300"
                          >
                            Bonif. 5910
                          </Badge>
                        ) : null}
                        {line.uses_un_tax_base ? (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            base UN
                          </Badge>
                        ) : null}
                        {line.unit_commercial || line.unit_tax ? (
                          <span className="text-[10px] text-muted-foreground">
                            {line.unit_commercial ?? "—"}
                            {line.unit_tax ? ` / ${line.unit_tax}` : ""}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={TD_RIGHT}>{formatQty(r?.quantity)}</td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.gross} />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.discount} variant="discount" />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.ipi_line} variant="add" />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.icms_st_line} variant="add" />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.fcp_st_line} variant="add" />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.outros} variant="add" />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell value={r?.effective_total} />
                    </td>
                    <td className={TD_RIGHT}>
                      <MoneyCell
                        value={r?.effective_unit_price}
                        variant="emphasis"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          IPI, ICMS ST e FCP ST vêm do{" "}
          <code className="rounded bg-muted px-1">det/imposto</code> da linha. «Outros»
          rateia só o <strong className="text-foreground">vOutro</strong> do ICMSTot
          (outras despesas), proporcional ao <strong className="text-foreground">vProd</strong>{" "}
          de cada item (CFOP 5910 excluído). Juros e demais rateios entram no total
          efetivo, mas não nesta coluna.
        </p>
      </CardContent>
    </Card>
  );
}

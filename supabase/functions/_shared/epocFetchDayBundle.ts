/**
 * Gate e tipos para o bundle diário EPOC (produtos + serviços + faturamento).
 * A edge `epoc-fetch-day-bundle` orquestra login/portal; este módulo decide se o dia
 * tem faturamento utilizável (senão o dia inteiro é descartado).
 */
import type { FaturamentoDayExtract } from "./epocFaturamentoCsv.ts";
import {
  interpretTabela3FromRows,
  type EpocFaturamentoCsvRow,
} from "./epocFaturamentoInterpret.ts";

export type EpocDayBundleDayStatus =
  | "ok"
  | "skipped_no_faturamento"
  | "error";

export type EpocDayBundleDayResult = {
  date_br: string;
  date_iso: string | null;
  status: EpocDayBundleDayStatus;
  message?: string;
  produtos_rows?: number;
  servicos_rows?: number;
  faturamento_rows?: number;
};

/** Converte linhas planas do extract em rows do interpretador. */
export function faturamentoExtractToInterpretRows(
  extract: FaturamentoDayExtract,
): EpocFaturamentoCsvRow[] {
  return extract.rows.map((r) => ({
    dataConsulta: r[0] || extract.dataConsulta,
    secao: r[1] ?? "",
    cols: r.slice(2),
  }));
}

/**
 * Dia com trabalho no PDV: há `#spanImprimir` com linhas **e** linha
 * `Total Geral:` na tabela_3. Sem isso, o dia é cancelado (não houve expediente).
 */
export function isFaturamentoDayUsable(extract: FaturamentoDayExtract): boolean {
  if (extract.rowCount <= 0) return false;
  const rows = faturamentoExtractToInterpretRows(extract);
  const t3 = interpretTabela3FromRows(rows)[0] ?? null;
  return t3?.totalGeral != null;
}

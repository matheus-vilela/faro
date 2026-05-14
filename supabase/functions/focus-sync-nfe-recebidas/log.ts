import { isVerboseLogs, LOG } from "./constants.ts";

/** Logs legíveis nos logs da Supabase Edge (filtrar por prefixo `[focus-sync-nfe-recebidas]`). */
export function slog(
  fase: string,
  empresa: string | null,
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  const base = { fase, empresa: empresa ?? "—", mensagem };
  const line =
    extras && Object.keys(extras).length > 0
      ? `${JSON.stringify({ ...base, ...extras })}`
      : `${JSON.stringify(base)}`;
  console.log(LOG, line);
}

/** Detalhe por página/checkpoint — só com `FOCUS_SYNC_VERBOSE_LOGS=true`. */
export function slogV(
  fase: string,
  empresa: string | null,
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  if (!isVerboseLogs()) return;
  slog(fase, empresa, mensagem, extras);
}

export function marcador(
  unidadeId: string,
  acao: string,
  detalhes: Record<string, unknown>,
): void {
  const isErr =
    acao.includes("ERRO") || acao.includes("EXCECAO") || acao.includes("FALH");
  if (!isVerboseLogs() && !isErr) return;
  console.log(LOG, JSON.stringify({ unidade: unidadeId, acao, ...detalhes }));
}

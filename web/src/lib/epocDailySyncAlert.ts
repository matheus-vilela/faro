import type { EpocIntegrationSettings } from "@/types/companyIntegration";

const SP_TZ = "America/Sao_Paulo";

/** Dia sem `#tblExport` / sem vendas no portal — rotina diária concluída, não é falha técnica. */
export function isEpocDailySyncBenignNoSales(
  s: Pick<
    EpocIntegrationSettings,
    | "epoc_daily_sync_last_attempt_ok"
    | "epoc_daily_sync_last_attempt_error"
    | "epoc_daily_sync_last_attempt_outcome"
  >,
): boolean {
  if (s.epoc_daily_sync_last_attempt_outcome === "no_tbl_export") {
    return true;
  }
  if (s.epoc_daily_sync_last_attempt_ok === true) {
    return false;
  }
  const err = (s.epoc_daily_sync_last_attempt_error ?? "").toLowerCase();
  if (!err.trim()) return false;
  return (
    err.includes("tblexport") ||
    err.includes("sem tabela") ||
    err.includes("nenhuma venda") ||
    err.includes("sem vendas") ||
    err.includes("sem dados de receitas")
  );
}

function ymdToBr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

function ymdInTimeZone(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Dia civil consultado no EPOC (`previous_day`) no instante da tentativa,
 * alinhado a `yesterdayDateBrInTz` da edge — não “hoje − 1” em relação a agora.
 */
export function epocDailySyncConsultedDayLabel(
  s: Pick<EpocIntegrationSettings, "epoc_daily_sync_last_consulted_day_br">,
  attemptAtIso: string,
): string {
  const stored = s.epoc_daily_sync_last_consulted_day_br?.trim();
  if (stored) return stored;

  const attemptAt = attemptAtIso.trim();
  if (!attemptAt) return "dia anterior";

  const attemptDate = new Date(attemptAt);
  if (!Number.isFinite(attemptDate.getTime())) return "dia anterior";

  const todayAtAttempt = ymdInTimeZone(attemptDate, SP_TZ);
  let probe = new Date(attemptDate.getTime() - 12 * 60 * 60 * 1000);
  for (let i = 0; i < 48; i++) {
    const ymd = ymdInTimeZone(probe, SP_TZ);
    if (ymd !== todayAtAttempt) {
      return ymdToBr(ymd);
    }
    probe = new Date(probe.getTime() - 60 * 60 * 1000);
  }

  const [y0, m0, d0] = todayAtAttempt.split("-").map((x) => parseInt(x, 10));
  const fb = new Date(Date.UTC(y0, m0 - 1, d0 - 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fb.getUTCDate())}/${pad(fb.getUTCMonth() + 1)}/${fb.getUTCFullYear()}`;
}

/** Data/hora da execução da rotina em America/Sao_Paulo. */
export function formatEpocDailySyncAttemptAtPtBr(attemptAtIso: string): string {
  const t = attemptAtIso.trim();
  if (!t) return "—";
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: SP_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

import { supabase } from "@/lib/supabase";

/** `YYYY-MM-DD` → `dd/MM/aaaa` (formato do portal EPOC). */
export function ymdToEpocConsultaDiaBr(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function todayYmdInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Dia civil futuro em São Paulo — o portal não tem vendas a importar. */
export function isEpocDaySalesSyncDateInFuture(
  ymd: string,
  now: Date = new Date(),
): boolean {
  return ymd > todayYmdInSaoPaulo(now);
}

export async function canShowEpocDaySalesSyncButton(input: {
  companyId: string;
  dateKey: string;
}): Promise<boolean> {
  if (isEpocDaySalesSyncDateInFuture(input.dateKey)) return false;

  const { data: integ, error: integErr } = await supabase
    .from("company_integrations")
    .select("enabled")
    .eq("company_id", input.companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  if (integErr || integ?.enabled !== true) return false;

  const { count: revenueCount, error: revErr } = await supabase
    .from("revenue_entries")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.companyId)
    .eq("entry_date", input.dateKey)
    .not("integration_import_batch_id", "is", null);
  if (revErr || (revenueCount ?? 0) > 0) return false;

  const { count: serviceCount, error: svcErr } = await supabase
    .from("service_daily_sales")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.companyId)
    .eq("sale_date", input.dateKey);
  if (svcErr || (serviceCount ?? 0) > 0) return false;

  return true;
}

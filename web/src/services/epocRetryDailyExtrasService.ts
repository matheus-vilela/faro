import { fetchSupabaseEdgeFunction } from "@/lib/supabase";

export type EpocRetryDailyExtrasResult =
  | {
      ok: true;
      retried_days?: number;
      ok_ops?: number;
      partial_sync_summary?: string | null;
      message?: string;
      remaining?: {
        services: string[];
        faturamento: string[];
      };
    }
  | { ok: false; error: string };

export async function retryEpocDailyExtras(params: {
  companyId: string;
  kinds?: Array<"services" | "faturamento">;
}): Promise<EpocRetryDailyExtrasResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-retry-daily-extras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId,
      kinds: params.kinds ?? ["services", "faturamento"],
    }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: `Resposta inválida (HTTP ${res.status}).` };
  }

  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === true
  ) {
    return payload as Extract<EpocRetryDailyExtrasResult, { ok: true }>;
  }

  const err =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Falha ao rebuscar (HTTP ${res.status}).`;

  return { ok: false, error: err };
}

import { supabase } from "@/lib/supabase";
import type { ExpectedCompanyAlert } from "@/types/companyAlert";

import { computeExpectedCompanyAlerts } from "./computeExpectedAlerts";

/**
 * Sincroniza a tabela `company_alerts` com o estado atual das regras:
 * remove linhas cujo problema deixou de existir; insere/atualiza abertos;
 * preserva linhas `dismissed` enquanto o problema continuar (não reabre).
 */
export async function syncCompanyAlerts(companyId: string): Promise<void> {
  const expected = await computeExpectedCompanyAlerts(companyId);
  const expectedKeys = new Set(expected.map((e) => e.dedupe_key));

  const { data: existingRows, error: fetchErr } = await supabase
    .from("company_alerts")
    .select("id, dedupe_key, status")
    .eq("company_id", companyId);

  if (fetchErr) {
    console.error(fetchErr);
    return;
  }

  for (const row of existingRows ?? []) {
    if (!expectedKeys.has(row.dedupe_key)) {
      const { error } = await supabase
        .from("company_alerts")
        .delete()
        .eq("id", row.id);
      if (error) console.error(error);
    }
  }

  const { data: afterDelete } = await supabase
    .from("company_alerts")
    .select("dedupe_key, status")
    .eq("company_id", companyId);

  const dismissedKeys = new Set(
    (afterDelete ?? [])
      .filter((r) => r.status === "dismissed")
      .map((r) => r.dedupe_key),
  );

  const now = new Date().toISOString();

  for (const e of expected) {
    if (dismissedKeys.has(e.dedupe_key)) continue;

    const { data: existing } = await supabase
      .from("company_alerts")
      .select("id")
      .eq("company_id", companyId)
      .eq("dedupe_key", e.dedupe_key)
      .maybeSingle();

    const base = {
      kind: e.kind,
      severity: e.severity,
      title: e.title,
      message: e.message,
      link_path: e.link_path,
      payload: e.payload,
      status: "open" as const,
      dismissed_at: null as string | null,
      updated_at: now,
    };

    if (existing?.id) {
      const { error } = await supabase
        .from("company_alerts")
        .update(base)
        .eq("id", existing.id);
      if (error) console.error(error);
    } else {
      const { error } = await supabase.from("company_alerts").insert({
        company_id: companyId,
        dedupe_key: e.dedupe_key,
        ...base,
      });
      if (error) console.error(error);
    }
  }
}

export async function dismissCompanyAlert(alertId: string): Promise<boolean> {
  const { error } = await supabase
    .from("company_alerts")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", alertId);
  return !error;
}

export function summarizeAlertsByKind(expected: ExpectedCompanyAlert[]): {
  lowStock: number;
  withoutBoleto: number;
  notReceived: number;
} {
  return {
    lowStock: expected.filter((a) => a.kind === "low_stock").length,
    withoutBoleto: expected.filter((a) => a.kind === "expense_no_boleto").length,
    notReceived: expected.filter((a) => a.kind === "recebimento_falta").length,
  };
}

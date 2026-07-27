/**
 * Persiste serviços + faturamento diários a partir do HTML do portal EPOC.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  extractFaturamentoRowsFromAcoesHtml,
} from "./epocFaturamentoCsv.ts";
import {
  interpretTabela3FromRows,
  interpretTabela5FromRows,
  interpretTabela6FromRows,
  type EpocFaturamentoCsvRow,
} from "./epocFaturamentoInterpret.ts";
import {
  brDateToIso,
  parsePtBrNumber,
  splitPaymentMethodLabel,
} from "./epocPtBrNumber.ts";
import { extractVendaServicosRowsFromAcoesHtml } from "./epocVendaServicosCsv.ts";

export type DayExtrasKind = "services" | "faturamento";

export type DayExtrasPersistResult = {
  ok: boolean;
  error?: string;
  itens?: number;
};

export { splitPaymentMethodLabel };

function faturamentoRowsToCsvRows(
  dataConsulta: string,
  flatRows: string[][],
): EpocFaturamentoCsvRow[] {
  return flatRows.map((r) => ({
    dataConsulta: r[0] || dataConsulta,
    secao: r[1] ?? "",
    cols: r.slice(2),
  }));
}

export async function upsertEpocSyncDayStatus(
  admin: SupabaseClient,
  companyId: string,
  saleDateIso: string,
  patch: {
    products_ok?: boolean;
    services_ok?: boolean;
    faturamento_ok?: boolean;
    products_error?: string | null;
    services_error?: string | null;
    faturamento_error?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { data: prev } = await admin
    .from("epoc_sync_day_status")
    .select(
      "products_ok, services_ok, faturamento_ok, products_error, services_error, faturamento_error",
    )
    .eq("company_id", companyId)
    .eq("sync_date", saleDateIso)
    .maybeSingle();

  const row = {
    company_id: companyId,
    sync_date: saleDateIso,
    products_ok: patch.products_ok ?? prev?.products_ok ?? false,
    services_ok: patch.services_ok ?? prev?.services_ok ?? false,
    faturamento_ok: patch.faturamento_ok ?? prev?.faturamento_ok ?? false,
    products_error:
      patch.products_error !== undefined
        ? patch.products_error
        : (prev?.products_error ?? null),
    services_error:
      patch.services_error !== undefined
        ? patch.services_error
        : (prev?.services_error ?? null),
    faturamento_error:
      patch.faturamento_error !== undefined
        ? patch.faturamento_error
        : (prev?.faturamento_error ?? null),
    updated_at: now,
  };

  const { error } = await admin.from("epoc_sync_day_status").upsert(row, {
    onConflict: "company_id,sync_date",
  });
  if (error) {
    console.warn("[epocPersistDailyExtras] day_status", error.message);
  }
}

export async function persistServicesFromAcoesHtml(
  admin: SupabaseClient,
  companyId: string,
  diaBr: string,
  acoesHtml: string,
): Promise<DayExtrasPersistResult> {
  const saleDate = brDateToIso(diaBr);
  if (!saleDate) {
    return { ok: false, error: `Data inválida: ${diaBr}` };
  }

  const extracted = extractVendaServicosRowsFromAcoesHtml(acoesHtml, diaBr);
  if (extracted.itensCount === 0) {
    const msg = extracted.message ?? "Sem itens de serviços.";
    // Dia sem serviços vendidos ainda conta como ok (não é falha de fetch).
    if (msg.includes("Sem id=tblExport") || msg.includes("não pôde ser")) {
      return { ok: false, error: msg, itens: 0 };
    }
    await upsertEpocSyncDayStatus(admin, companyId, saleDate, {
      services_ok: true,
      services_error: null,
    });
    return { ok: true, itens: 0 };
  }

  const itemRows = extracted.rows.filter((r) => r[1] === "itens");
  let saved = 0;
  for (const r of itemRows) {
    const code = (r[2] ?? "").trim();
    const name = (r[3] ?? "").trim();
    if (!code || !name) continue;

    const quantity = parsePtBrNumber(r[4] ?? "") ?? 0;
    const unitPrice = parsePtBrNumber(r[5] ?? "") ?? 0;
    const grossValue = parsePtBrNumber(r[6] ?? "") ?? 0;
    const discount = parsePtBrNumber(r[7] ?? "") ?? 0;
    const surcharge = parsePtBrNumber(r[8] ?? "") ?? 0;
    const allocation = parsePtBrNumber(r[9] ?? "") ?? 0;

    const { data: existing, error: findErr } = await admin
      .from("services")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("code", code)
      .maybeSingle();
    if (findErr) {
      return { ok: false, error: findErr.message };
    }

    let serviceId = existing?.id as string | undefined;
    if (!serviceId) {
      const { data: created, error: insErr } = await admin
        .from("services")
        .insert({
          company_id: companyId,
          code,
          name,
          is_active: true,
        })
        .select("id")
        .single();
      if (insErr || !created) {
        return { ok: false, error: insErr?.message ?? "Falha ao criar serviço" };
      }
      serviceId = created.id as string;
    } else if (existing && existing.name !== name) {
      await admin
        .from("services")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", serviceId);
    }

    const { error: saleErr } = await admin.from("service_daily_sales").upsert(
      {
        company_id: companyId,
        service_id: serviceId,
        sale_date: saleDate,
        quantity,
        unit_price: unitPrice,
        gross_value: grossValue,
        discount,
        surcharge,
        allocation,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,service_id,sale_date" },
    );
    if (saleErr) {
      return { ok: false, error: saleErr.message };
    }
    saved += 1;
  }

  await upsertEpocSyncDayStatus(admin, companyId, saleDate, {
    services_ok: true,
    services_error: null,
  });
  return { ok: true, itens: saved };
}

export async function persistFaturamentoFromAcoesHtml(
  admin: SupabaseClient,
  companyId: string,
  diaBr: string,
  acoesHtml: string,
): Promise<DayExtrasPersistResult> {
  const faturamentoDate = brDateToIso(diaBr);
  if (!faturamentoDate) {
    return { ok: false, error: `Data inválida: ${diaBr}` };
  }

  const extracted = extractFaturamentoRowsFromAcoesHtml(acoesHtml, diaBr);
  if (extracted.rowCount === 0) {
    return {
      ok: false,
      error: extracted.message ?? "Sem dados de faturamento.",
      itens: 0,
    };
  }

  const csvRows = faturamentoRowsToCsvRows(diaBr, extracted.rows);
  const t3 = interpretTabela3FromRows(csvRows)[0] ?? null;
  const t5 = interpretTabela5FromRows(csvRows)[0] ?? null;
  const t6 = interpretTabela6FromRows(csvRows)[0] ?? null;

  const geral = t3?.totalGeral;
  if (!geral) {
    return {
      ok: false,
      error: 'Faturamento sem linha "Total Geral:".',
    };
  }

  const produtosServicosJson = t5
    ? {
        produtos: t5.produtos,
        servicos: t5.servicos,
        avisos: t5.avisos,
      }
    : {};
  const fiscalJson = t6?.fiscal ?? [];

  const { data: fatRow, error: fatErr } = await admin
    .from("epoc_faturamento_daily")
    .upsert(
      {
        company_id: companyId,
        faturamento_date: faturamentoDate,
        quantity: parsePtBrNumber(geral.quantidade),
        produtos: parsePtBrNumber(geral.produtos),
        servicos: parsePtBrNumber(geral.servicos),
        taxas: parsePtBrNumber(geral.taxas),
        total: parsePtBrNumber(geral.total),
        ticket_medio: parsePtBrNumber(geral.media),
        produtos_servicos_json: produtosServicosJson,
        fiscal_json: fiscalJson,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,faturamento_date" },
    )
    .select("id")
    .single();

  if (fatErr || !fatRow) {
    return { ok: false, error: fatErr?.message ?? "Falha ao gravar faturamento" };
  }

  const faturamentoDailyId = fatRow.id as string;

  // Substitui formas do dia (idempotente).
  await admin
    .from("epoc_faturamento_daily_payment_methods")
    .delete()
    .eq("faturamento_daily_id", faturamentoDailyId);

  let pmCount = 0;
  for (const pm of t6?.formasPagamento ?? []) {
    const { sku, name } = splitPaymentMethodLabel(pm.forma);
    const { data: existingPm, error: findPmErr } = await admin
      .from("payment_methods")
      .select("id")
      .eq("company_id", companyId)
      .eq("sku", sku)
      .maybeSingle();
    if (findPmErr) {
      return { ok: false, error: findPmErr.message };
    }

    let paymentMethodId = existingPm?.id as string | undefined;
    if (!paymentMethodId) {
      const { data: createdPm, error: insPmErr } = await admin
        .from("payment_methods")
        .insert({
          company_id: companyId,
          sku,
          name,
          is_active: true,
        })
        .select("id")
        .single();
      if (insPmErr || !createdPm) {
        return {
          ok: false,
          error: insPmErr?.message ?? "Falha ao criar forma de pagamento",
        };
      }
      paymentMethodId = createdPm.id as string;
    } else {
      await admin
        .from("payment_methods")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", paymentMethodId);
    }

    const { error: linkErr } = await admin
      .from("epoc_faturamento_daily_payment_methods")
      .insert({
        company_id: companyId,
        faturamento_daily_id: faturamentoDailyId,
        payment_method_id: paymentMethodId,
        faturamento_date: faturamentoDate,
        operation_count: parsePtBrNumber(pm.operacao),
        amount: parsePtBrNumber(pm.valores) ?? 0,
      });
    if (linkErr) {
      return { ok: false, error: linkErr.message };
    }
    pmCount += 1;
  }

  await upsertEpocSyncDayStatus(admin, companyId, faturamentoDate, {
    faturamento_ok: true,
    faturamento_error: null,
  });

  return { ok: true, itens: pmCount };
}

export async function listEpocSyncGaps(
  admin: SupabaseClient,
  companyId: string,
  limit = 62,
): Promise<{
  services: string[];
  faturamento: string[];
}> {
  const { data, error } = await admin
    .from("epoc_sync_day_status")
    .select("sync_date, services_ok, faturamento_ok")
    .eq("company_id", companyId)
    .or("services_ok.eq.false,faturamento_ok.eq.false")
    .order("sync_date", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return { services: [], faturamento: [] };
  }

  const services: string[] = [];
  const faturamento: string[] = [];
  for (const row of data) {
    const iso = String(row.sync_date);
    if (!row.services_ok) services.push(iso);
    if (!row.faturamento_ok) faturamento.push(iso);
  }
  return { services, faturamento };
}

export function buildPartialSyncSummary(gaps: {
  services: string[];
  faturamento: string[];
}): string | null {
  const parts: string[] = [];
  if (gaps.services.length > 0) {
    parts.push(
      `serviços em falta em ${gaps.services.length} dia(s)`,
    );
  }
  if (gaps.faturamento.length > 0) {
    parts.push(
      `faturamento em falta em ${gaps.faturamento.length} dia(s)`,
    );
  }
  if (parts.length === 0) return null;
  return `Sync parcial: conseguiu produtos, mas faltam ${parts.join(" e ")}.`;
}

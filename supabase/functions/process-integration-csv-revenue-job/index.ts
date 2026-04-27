/**
 * Processa `integration_csv_revenue_import_jobs` em **várias invocações** (cursor
 * `csv_resume_row_index` + auto-disparo com `resume: true` e `EdgeRuntime.waitUntil`),
 * até percorrer todo o CSV: coluna "Total recebido(R$)" + `data_consumo`.
 * Título da receita: texto da coluna **Produto** (ou "Nome do produto"), senão fallback EPOC+data.
 * Categoria: primeira folha de receita **operacional** (excl. dedução DRE), resolvida no servidor.
 *
 * Autenticação: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Corpo inicial (webhook): `{ "job_id" }` ou `{ "record": { "id" } }`.
 * Continuação (interna): `{ "job_id", "resume": true }`.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COL_TOTAL_RECEBIDO = "Total recebido(R$)";
/** Cabeçalhos aceites para o nome da linha (título do lançamento). */
const COL_PRODUTO_ALIASES = ["Produto", "Nome do produto"];
/** Máximo de linhas de dados visitadas por invocação (além do orçamento de tempo). */
const ROWS_HARD_CAP = 55;
/** Orçamento de tempo por invocação (ms); acima disso agenda continuação. */
const TIME_BUDGET_MS = 22_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function parseCsvSemicolon(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0]!.split(";").map((c) => c.trim().replace(/^"|"$/g, ""));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    rows.push(
      lines[i]!.split(";").map((c) => c.trim().replace(/^"|"$/g, "")),
    );
  }
  return { headers, rows };
}

function parseFlexibleDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseBrDate(t);
}

function parseBrDate(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!d || !mo || !y || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseBrMoney(s: string): number | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  let x = t.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(x)) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{2}$/.test(x)) {
    x = x.replace(",", ".");
  } else if (/^\d+\.\d{2}$/.test(x)) {
    /* ok */
  } else {
    x = x.replace(/\./g, "").replace(",", ".");
  }
  const v = Number(x);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}

function extractJobId(body: Record<string, unknown>): string | null {
  if (typeof body.job_id === "string" && body.job_id.trim()) return body.job_id.trim();
  const rec = body.record as Record<string, unknown> | undefined;
  if (rec && typeof rec.id === "string" && rec.id.trim()) return rec.id.trim();
  if (body.type === "INSERT" && rec?.id) return String(rec.id);
  const nested = body.body ?? body.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    if (typeof n.job_id === "string" && n.job_id.trim()) return n.job_id.trim();
    const nr = n.record as Record<string, unknown> | undefined;
    if (nr && typeof nr.id === "string" && nr.id.trim()) return nr.id.trim();
  }
  return null;
}

/** Primeira subcategoria (folha) de receita operacional, excluindo papel DEDUCAO no DRE. */
async function resolveOperationalRevenueLeafCategory(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<
  | { ok: true; subcategoryId: string; categoryId: string | null }
  | { ok: false; message: string }
> {
  const { data: rows, error } = await admin
    .from("company_categories")
    .select("id, parent_id, name, natureza, tipo, ativo, papel_receita_dre")
    .eq("company_id", companyId)
    .eq("natureza", "RECEITA")
    .eq("tipo", "OPERACIONAL")
    .order("ordem", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { ok: false, message: error.message };
  const list = (rows ?? []) as Array<{
    id: string;
    parent_id: string | null;
    name: string;
    ativo?: boolean | null;
    papel_receita_dre?: string | null;
  }>;
  const idsThatAreParents = new Set(
    list.map((r) => r.parent_id).filter((x): x is string => !!x),
  );
  const pick = list.find(
    (c) =>
      !idsThatAreParents.has(c.id) &&
      c.ativo !== false &&
      c.papel_receita_dre !== "DEDUCAO",
  );
  if (!pick) {
    return {
      ok: false,
      message:
        "Nao ha categoria de receita operacional (folha) na empresa. Cadastre em Configuracoes > Categorias.",
    };
  }
  return {
    ok: true,
    subcategoryId: pick.id,
    categoryId: pick.parent_id ?? null,
  };
}

function scheduleResume(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  jobId: string,
): void {
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-integration-csv-revenue-job`;
  const next = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId, resume: true }),
  }).catch((e) => console.error("[process-integration-csv-revenue-job] resume fetch", e));
  try {
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      EdgeRuntime.waitUntil(next);
    } else {
      void next;
    }
  } catch {
    void next;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: "Não autorizado" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const jobId = extractJobId(body);
  if (!jobId) {
    return json(
      { ok: false, error: "Informe job_id ou payload de webhook com record.id" },
      400,
    );
  }

  const isResume = body.resume === true || body.phase === "resume";

  let jobRow: Record<string, unknown> | null = null;

  if (!isResume) {
    const { data: claimed, error: claimErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "PROCESSING",
        updated_at: new Date().toISOString(),
        csv_resume_row_index: 0,
      })
      .eq("id", jobId)
      .eq("status", "PENDING")
      .select("*")
      .maybeSingle();

    if (claimErr) {
      return json({ ok: false, error: claimErr.message }, 500);
    }
    if (!claimed) {
      const { data: existing } = await admin
        .from("integration_csv_revenue_import_jobs")
        .select("id, status")
        .eq("id", jobId)
        .maybeSingle();
      if (existing?.status === "COMPLETED") {
        return json({ ok: true, skipped: true, reason: "already_completed" });
      }
      return json(
        { ok: false, error: "Job não está PENDING (em processamento ou inexistente)." },
        409,
      );
    }
    jobRow = claimed as Record<string, unknown>;
  } else {
    const { data: existing, error: loadErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("status", "PROCESSING")
      .maybeSingle();
    if (loadErr) {
      return json({ ok: false, error: loadErr.message }, 500);
    }
    if (!existing) {
      return json(
        { ok: false, error: "Job não encontrado ou não está em PROCESSING (retomada inválida)." },
        409,
      );
    }
    jobRow = existing as Record<string, unknown>;
  }

  const job = jobRow as {
    id: string;
    company_id: string;
    storage_bucket: string;
    storage_path: string;
    requested_by: string;
    csv_resume_row_index?: number;
    metadata?: Record<string, unknown> | null;
  };

  const fail = async (msg: string) => {
    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "FAILED",
        error_message: msg.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return json({ ok: false, error: msg }, 422);
  };

  try {
    const catPick = await resolveOperationalRevenueLeafCategory(admin, job.company_id);
    if (!catPick.ok) {
      return await fail(catPick.message);
    }
    const subcategoryId = catPick.subcategoryId;
    const categoryId = catPick.categoryId;

    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(job.storage_bucket)
      .download(job.storage_path);
    if (dlErr || !fileBlob) {
      return await fail(dlErr?.message ?? "Falha ao baixar CSV do Storage.");
    }
    const text = await fileBlob.text();
    const { headers, rows } = parseCsvSemicolon(text);
    if (headers.length === 0) {
      return await fail("CSV sem cabeçalho.");
    }

    const normHeaders = headers.map(normalizeHeaderLabel);
    const targetNorm = normalizeHeaderLabel(COL_TOTAL_RECEBIDO);
    const totalCol = normHeaders.indexOf(targetNorm);
    if (totalCol < 0) {
      return await fail(
        `Coluna "${COL_TOTAL_RECEBIDO}" não encontrada no CSV (cabeçalhos: ${headers.slice(0, 12).join("; ")}…).`,
      );
    }

    const dataConsumoIdx = normHeaders.indexOf(
      normalizeHeaderLabel("data_consumo"),
    );
    if (dataConsumoIdx < 0) {
      return await fail('Coluna "data_consumo" não encontrada no CSV.');
    }

    let produtoCol = -1;
    for (const alias of COL_PRODUTO_ALIASES) {
      const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
      if (j >= 0) {
        produtoCol = j;
        break;
      }
    }

    const startOffset = Math.max(0, Number(job.csv_resume_row_index ?? 0) || 0);
    if (startOffset > rows.length) {
      return await fail("Cursor de retomada inválido (fora do CSV).");
    }

    const priorMeta =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};

    const batchByDate = new Map<string, string>();
    const bbd = priorMeta.batch_by_reference_date;
    if (bbd && typeof bbd === "object" && !Array.isArray(bbd)) {
      for (const [k, v] of Object.entries(bbd as Record<string, unknown>)) {
        if (typeof v === "string") batchByDate.set(k, v);
      }
    }

    let createdChunk = 0;
    let skippedChunk = 0;
    const prevCreated = Number(priorMeta.revenue_entries_created_total ?? 0) || 0;
    const prevSkipped = Number(priorMeta.rows_skipped_total ?? 0) || 0;

    const t0 = Date.now();
    let idx = startOffset;
    while (idx < rows.length) {
      if (idx - startOffset >= ROWS_HARD_CAP) break;
      if (Date.now() - t0 >= TIME_BUDGET_MS) break;

      const row = rows[idx]!;
      const totalCell = row[totalCol] ?? "";
      const gross = parseBrMoney(totalCell);
      if (gross == null) {
        skippedChunk += 1;
        idx += 1;
        continue;
      }

      const rawDate = row[dataConsumoIdx] ?? "";
      const entryDate = parseFlexibleDate(rawDate);
      if (!entryDate) {
        skippedChunk += 1;
        idx += 1;
        continue;
      }

      let batchId = batchByDate.get(entryDate);
      if (!batchId) {
        const { data: batchRow, error: batchErr } = await admin
          .from("company_revenue_integration_import_batches")
          .insert({
            company_id: job.company_id,
            provider: "epoc",
            reference_date: entryDate,
            status: "running",
            metadata: {
              csv_import_job_id: job.id,
              source: "process-integration-csv-revenue-job",
            },
          })
          .select("id")
          .single();
        if (batchErr || !batchRow?.id) {
          return await fail(batchErr?.message ?? "Falha ao criar lote de importação.");
        }
        batchId = batchRow.id as string;
        batchByDate.set(entryDate, batchId);
      }

      const rawProduto =
        produtoCol >= 0 ? String(row[produtoCol] ?? "").trim() : "";
      const title =
        rawProduto.length > 0
          ? rawProduto.replace(/\s+/g, " ")
          : `EPOC ${entryDate} #${idx + 1}`;

      const { data: entryId, error: rpcErr } = await admin.rpc(
        "create_revenue_entry",
        {
          p_payload: {
            company_id: job.company_id,
            entry_date: entryDate,
            title,
            entry_mode: "manual",
            revenue_type: "operational",
            category_id: categoryId,
            subcategory_id: subcategoryId,
            gross_amount: gross,
            product_id: null,
            recipe_id: null,
            quantity: null,
            pricing_mode: null,
            unit_value: null,
            _csv_import_job_id: job.id,
            integration_import_batch_id: batchId,
          },
        },
      );
      if (rpcErr) {
        return await fail(rpcErr.message ?? "Falha ao criar receita.");
      }
      if (!entryId) {
        return await fail("RPC create_revenue_entry não devolveu id.");
      }
      createdChunk += 1;
      idx += 1;
    }

    const nextOffset = idx;
    const now = new Date().toISOString();
    const batchMapObj = Object.fromEntries(batchByDate);
    const newMeta: Record<string, unknown> = {
      ...priorMeta,
      batch_by_reference_date: batchMapObj,
      csv_total_data_rows: rows.length,
      revenue_entries_created_total: prevCreated + createdChunk,
      rows_skipped_total: prevSkipped + skippedChunk,
    };

    const done = nextOffset >= rows.length;

    if (!done) {
      await admin
        .from("integration_csv_revenue_import_jobs")
        .update({
          csv_resume_row_index: nextOffset,
          metadata: newMeta,
          updated_at: now,
        })
        .eq("id", jobId);

      scheduleResume(supabaseUrl, serviceKey, anonKey, jobId);

      return json({
        ok: true,
        job_id: jobId,
        phase: "chunk",
        next_row_index: nextOffset,
        total_rows: rows.length,
        revenue_entries_created_this_chunk: createdChunk,
        rows_skipped_this_chunk: skippedChunk,
        revenue_entries_created_total: prevCreated + createdChunk,
        continuing: true,
      });
    }

    const batchIdList = [...new Set(Object.values(batchMapObj))];
    if (batchIdList.length) {
      await admin
        .from("company_revenue_integration_import_batches")
        .update({ status: "completed", updated_at: now })
        .in("id", batchIdList);
    }

    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "COMPLETED",
        error_message: null,
        csv_resume_row_index: rows.length,
        metadata: newMeta,
        updated_at: now,
      })
      .eq("id", jobId);

    return json({
      ok: true,
      job_id: jobId,
      phase: "completed",
      total_rows: rows.length,
      revenue_entries_created_this_chunk: createdChunk,
      rows_skipped_this_chunk: skippedChunk,
      revenue_entries_created_total: prevCreated + createdChunk,
      rows_skipped_total: prevSkipped + skippedChunk,
      batches: batchIdList.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "FAILED",
        error_message: msg.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return json({ ok: false, error: msg }, 500);
  }
});

// @ts-nocheck
/**
 * 
 * Listagem **resumida** de NF-e recebidas na Focus (`GET /v2/nfes_recebidas`), usando
 * `x-total-count` e `x-max-version` nos headers para paginação. Apenas notas com
 * `nfe_completa` explicitamente verdadeiro são gravadas em `focus_get_sync_nfe_staging`.
 *
 * **Cron:** `Authorization: Bearer <FOCUS_NFE_RECEBIDAS_CRON_SECRET>` (mesmo secret da sync completa).
 * Body opcional: `{ "company_id": "<uuid>" }` para uma unidade.
 *
 * **Manual:** `{ "manual": true, "company_id": "<uuid>" }` + `Authorization: Bearer <JWT>`.
 * Opcional: `versao` (número inicial do cursor; senão usa `focusnfe.nfes_recebidas_ultima_versao` ou 0).
 * Opcional: `onboarding: true` — fluxo de onboarding fiscal: na **primeira** resposta de listagem Focus grava
 * `companies.onboarding_fiscal.max_nfes_sync` como `len(lista) + x-total-count` (total estimado a sincronizar), preservando `sync`, `nfes_*` e `completed`.
 *
 * Env: `SUPABASE_*`, `FOCUS_NFE_TOKEN`, `FOCUS_NFE_API_BASE` (opcional), `FOCUS_GET_SYNC_MAX_COMPANIES_PER_RUN` (default 1),
 * `FOCUS_GET_SYNC_MAX_PAGES` (default 80). O tamanho da página de resultados é o definido pela API Focus (sem `limite` na query).
 * Para cada nota gravada, faz download do XML em **blocos paralelos de 10** (`GET .../{chave}.xml`);
 * entre blocos aplica `FOCUS_NFE_XML_THROTTLE_MS` (default 450 ms).
 * Com pelo menos uma linha em `focus_get_sync_nfe_staging`, enfileira `focus_get_sync_nfe_interpret_jobs`
 * (com `onboarding` quando o body pediu `onboarding: true`).
 * (processamento assíncrono via pg_cron → `focus-get-sync-nfe-interpret-staging`).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const LOG = "[focus-get-sync-nfe]";

/** Downloads de XML em paralelo por lote; throttle só entre lotes. */
const XML_DOWNLOAD_PARALLEL = 10;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function intFromEnv(
  name: string,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function focusIdEmpresa(raw: Record<string, unknown> | undefined): unknown {
  const v = raw?.id_empresa;
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return null;
}

/** Só aceita `nfe_completa` explicitamente verdadeiro (não trata omissão como true). */
function isNfeCompletaExplicitTrue(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "sim" || s === "yes") return true;
  }
  return false;
}

function intHeader(res: Response, canonical: string): number | null {
  const raw = res.headers.get(canonical);
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

function throttleMsBetweenXmlDownloads(): number {
  const raw = Deno.env.get("FOCUS_NFE_XML_THROTTLE_MS")?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 450;
}

function retryAfterDelayMs(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 300_000);
  const deadline = Date.parse(raw);
  if (Number.isFinite(deadline)) {
    const w = deadline - Date.now();
    if (Number.isFinite(w))
      return Math.min(Math.max(0, Math.floor(w)), 300_000);
  }
  return null;
}

async function fetchNfeRecebidaXmlWithRetry(
  xmlUrl: string,
  focusToken: string,
  chaveNfe44: string,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; status: number }> {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let xmlRes: Response;
    try {
      xmlRes = await fetch(xmlUrl, {
        method: "GET",
        headers: {
          Authorization: focusBasicAuthHeader(focusToken),
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      console.warn(
        LOG,
        JSON.stringify({
          fase: "xml_focus_erro_rede",
          chave_nfe_44: chaveNfe44,
          tentativa: attempt,
          erro: String(e),
        }),
      );
      if (attempt === maxAttempts) {
        return { ok: false, status: 0 };
      }
      await sleep(Math.min(3000 * attempt, 25_000));
      continue;
    }

    const buf = new Uint8Array(await xmlRes.arrayBuffer());

    if (xmlRes.status === 429) {
      const fromHeader = retryAfterDelayMs(xmlRes);
      const backoff = Math.min(1500 * 2 ** (attempt - 1), 90_000);
      const waitMs = fromHeader ?? backoff;
      console.warn(
        LOG,
        `xml HTTP 429 chave=${chaveNfe44} tentativa=${attempt}/${maxAttempts} espera_ms=${waitMs}`,
      );
      if (attempt === maxAttempts) return { ok: false, status: 429 };
      await sleep(waitMs);
      continue;
    }

    if (
      (xmlRes.status === 503 || xmlRes.status === 502) &&
      attempt < maxAttempts
    ) {
      const waitMs = Math.min(4000 * attempt, 45_000);
      console.warn(
        LOG,
        `xml HTTP ${xmlRes.status} chave=${chaveNfe44} retry em ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    if (xmlRes.ok && buf.length >= 500) {
      return { ok: true, buf };
    }

    console.warn(
      LOG,
      JSON.stringify({
        fase: "xml_focus_resposta",
        chave_nfe_44: chaveNfe44,
        mensagem: "HTTP não OK ou payload pequeno",
        http_status: xmlRes.status,
        bytes: buf.length,
      }),
    );
    return { ok: false, status: xmlRes.status };
  }
  return { ok: false, status: 429 };
}

type CoRow = {
  id: string;
  document?: string | null;
  focusnfe?: Record<string, unknown>;
};

type NfeCabLike = Record<string, unknown>;

type OnboardingFiscalState = {
  sync: boolean;
  max_nfes_sync: number;
  nfes_sync: number;
  nfes_ignored: number;
  completed: boolean;
};

function normalizeOnboardingFiscal(raw: unknown): OnboardingFiscalState {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const num = (k: string) => {
    const v = o[k];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  return {
    sync: o["sync"] === false ? false : true,
    max_nfes_sync: num("max_nfes_sync"),
    nfes_sync: num("nfes_sync"),
    nfes_ignored: num("nfes_ignored"),
    completed: o["completed"] === true,
  };
}

async function mergeOnboardingFiscalMaxNfes(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  maxNfesSync: number,
): Promise<{ error?: string }> {
  const { data: row, error: rErr } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  const prev = normalizeOnboardingFiscal(row?.onboarding_fiscal);
  const next: OnboardingFiscalState = { ...prev, max_nfes_sync: maxNfesSync };
  const { error: uErr } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (uErr) return { error: uErr.message };
  return {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    const tWall0 = performance.now();

    // --- Passo 1: body, segredo cron / manual + JWT, env Supabase + Focus ---
    const bodyRaw = await req.json().catch(() => ({}));
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};

  const onboardingFlow = body.onboarding === true;

  const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  if (!expected) {
    return json(
      {
        ok: false,
        error:
          "Defina FOCUS_NFE_RECEBIDAS_CRON_SECRET (mesmo secret usado em focus-sync-nfe-recebidas).",
      },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isCron = bearer === expected;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const focusToken = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();
  const apiBase = (
    Deno.env.get("FOCUS_NFE_API_BASE")?.trim() || "https://api.focusnfe.com.br"
  ).replace(/\/$/, "");

  if (!supabaseUrl || !anonKey || !serviceKey || !focusToken) {
    return json(
      { ok: false, error: "Variáveis Supabase ou FOCUS_NFE_TOKEN em falta." },
      500,
    );
  }

  const maxCompanies = intFromEnv(
    "FOCUS_GET_SYNC_MAX_COMPANIES_PER_RUN",
    1,
    1,
    500,
  );
  const maxPages = intFromEnv("FOCUS_GET_SYNC_MAX_PAGES", 80, 1, 500);

  const cronFilterCompanyId = isCron
    ? String(body.company_id ?? "").trim()
    : "";

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let companiesToProcess: CoRow[] = [];
  let isManualSingle = false;
  let bodyVersaoInicial: number | null = null;

  if (isCron) {
    const { data: companies, error: listErr } = await admin
      .from("companies")
      .select("id, document, focusnfe");

    if (listErr) {
      console.error(LOG, "list_companies", listErr.message);
      return json({ ok: false, error: listErr.message }, 500);
    }
    let list = (companies ?? []) as CoRow[];
    if (cronFilterCompanyId) {
      list = list.filter((c) => String(c.id) === cronFilterCompanyId);
    }
    companiesToProcess = list;
  } else {
    if (body.manual !== true) {
      return json(
        {
          ok: false,
          error:
            "Não autorizado. Use Bearer com o secret do cron ou body { manual: true, company_id } com sessão válida.",
        },
        401,
      );
    }
    const companyIdManual = String(body.company_id ?? "").trim();
    if (!companyIdManual) {
      return json(
        {
          ok: false,
          error: "manual: true requer company_id (UUID da unidade).",
        },
        400,
      );
    }
    if (!authHeader.startsWith("Bearer ") || !bearer) {
      return json(
        { ok: false, error: "Envie Authorization: Bearer <JWT da sessão>." },
        401,
      );
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json(
        { ok: false, error: "Sessão inválida. Entre novamente." },
        401,
      );
    }
    const { data: mem, error: memErr } = await userClient
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyIdManual)
      .maybeSingle();
    if (memErr || !mem) {
      return json({ ok: false, error: "Sem acesso a esta unidade." }, 403);
    }
    const { data: oneRow, error: coErr } = await admin
      .from("companies")
      .select("id, document, focusnfe")
      .eq("id", companyIdManual)
      .maybeSingle();
    if (coErr || !oneRow) {
      return json({ ok: false, error: "Unidade não encontrada." }, 404);
    }
    companiesToProcess = [oneRow as CoRow];
    isManualSingle = true;
    const rawv = body.versao;
    if (rawv !== undefined && rawv !== null && String(rawv).trim() !== "") {
      const n = Number(rawv);
      if (Number.isFinite(n) && n >= 0) bodyVersaoInicial = Math.floor(n);
    }
  }

  const execId = crypto.randomUUID();

  // Elegíveis: id_empresa Focus + CNPJ 14 dígitos + cap empresas
  const detail: Array<Record<string, unknown>> = [];
  let eligibleSlots = 0;
  const eligible: CoRow[] = [];

  for (const row of companiesToProcess) {
    const companyId = String(row.id);
    const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);
    if (!focusIdEmpresa(focusnfe)) {
      detail.push({ company_id: companyId, skipped: "sem id_empresa Focus" });
      continue;
    }
    if (cnpjDigits.length !== 14) {
      detail.push({
        company_id: companyId,
        skipped: "document sem CNPJ 14 dígitos",
      });
      continue;
    }
    if (eligibleSlots >= maxCompanies) continue;
    eligibleSlots += 1;
    eligible.push(row);
  }

  // --- Passo 2: para cada unidade, GET na Focus (headers + versão) e staging só nfe_completa true ---
  for (const row of eligible) {
    const companyId = String(row.id);
    const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);

    const storedRaw = Number(focusnfe.nfes_recebidas_ultima_versao);
    const cursorPersistido =
      Number.isFinite(storedRaw) && storedRaw >= 0 ? Math.floor(storedRaw) : 0;
    let versao =
      isManualSingle && bodyVersaoInicial !== null
        ? bodyVersaoInicial
        : cursorPersistido;

    let quantasBuscas = 0;
    let notasEncontradas = 0;
    const focusHttpMs: number[] = [];
    const tCompany0 = performance.now();
    const xmlGapMs = throttleMsBetweenXmlDownloads();
    let onboardingFirstListMaxWritten = false;

    if (onboardingFlow) {
      console.log(
        LOG,
        JSON.stringify({
          fase: "onboarding_processamento",
          company_id: companyId,
          exec_id: execId,
        }),
      );
    }

    for (let page = 0; page < maxPages; page++) {
      const listUrl = `${apiBase}/v2/nfes_recebidas?cnpj=${encodeURIComponent(cnpjDigits)}&versao=${versao}`;

      const tHttp0 = performance.now();
      let listRes: Response;
      try {
        listRes = await fetch(listUrl, {
          method: "GET",
          headers: {
            Authorization: focusBasicAuthHeader(focusToken),
            Accept: "application/json",
          },
        });
      } catch (e) {
        console.error(LOG, "fetch lista", companyId, e);
        detail.push({
          company_id: companyId,
          cnpj: cnpjDigits,
          ok: false,
          error: "falha de rede na lista Focus",
          quantasBuscasForamExecutadas: quantasBuscas,
          notasEncontradas: 0,
        });
        break;
      }
      focusHttpMs.push(Math.round(performance.now() - tHttp0));
      quantasBuscas += 1;

      const xTotalCount = intHeader(listRes, "x-total-count");
      const xMaxVersion = intHeader(listRes, "x-max-version");

      const listText = await listRes.text();
      if (!listRes.ok) {
        detail.push({
          company_id: companyId,
          cnpj: cnpjDigits,
          ok: false,
          error: `Focus lista HTTP ${listRes.status}: ${listText.slice(0, 200)}`,
          quantasBuscasForamExecutadas: quantasBuscas,
          notasEncontradas: notasEncontradas,
        });
        break;
      }

      let lista: unknown;
      try {
        lista = listText ? JSON.parse(listText) : [];
      } catch {
        detail.push({
          company_id: companyId,
          cnpj: cnpjDigits,
          ok: false,
          error: `Resposta lista inválida (HTTP ${listRes.status})`,
          quantasBuscasForamExecutadas: quantasBuscas,
          notasEncontradas: notasEncontradas,
        });
        break;
      }

      if (!Array.isArray(lista)) {
        detail.push({
          company_id: companyId,
          cnpj: cnpjDigits,
          ok: false,
          error: `Formato de lista inesperado (HTTP ${listRes.status})`,
          quantasBuscasForamExecutadas: quantasBuscas,
          notasEncontradas: notasEncontradas,
        });
        break;
      }

      const cabList = lista as NfeCabLike[];

      if (onboardingFlow && !onboardingFirstListMaxWritten) {
        onboardingFirstListMaxWritten = true;
        const xTc = xTotalCount ?? 0;
        const maxNfes = Math.max(0, cabList.length + xTc);
        const { error: obErr } = await mergeOnboardingFiscalMaxNfes(
          admin,
          companyId,
          maxNfes,
        );
        if (obErr) {
          console.warn(LOG, "onboarding_fiscal_max_nfes", companyId, obErr);
        }
      }

      const completas = cabList.filter(
        (cab) =>
          isNfeCompletaExplicitTrue(cab["nfe_completa"]) &&
          cab["situacao"] === "autorizada",
      );

      const completasComChave = completas
        .map((cab) => ({
          cab,
          chave: String(cab["chave_nfe"] ?? "").replace(/\D/g, ""),
        }))
        .filter((x) => x.chave.length === 44);

      for (
        let chunkStart = 0;
        chunkStart < completasComChave.length;
        chunkStart += XML_DOWNLOAD_PARALLEL
      ) {
        if (chunkStart > 0 && xmlGapMs > 0) await sleep(xmlGapMs);
        const chunk = completasComChave.slice(
          chunkStart,
          chunkStart + XML_DOWNLOAD_PARALLEL,
        );

        const chunkWithXml = await Promise.all(
          chunk.map(async ({ cab, chave }) => {
            const xmlUrl = `${apiBase}/v2/nfes_recebidas/${encodeURIComponent(chave)}.xml?cnpj=${encodeURIComponent(cnpjDigits)}`;
            const got = await fetchNfeRecebidaXmlWithRetry(
              xmlUrl,
              focusToken,
              chave,
            );
            let xmlContent: string | null = null;
            if (got.ok) {
              const raw = new TextDecoder("utf-8", { fatal: false }).decode(
                got.buf,
              );
              const head = raw
                .slice(0, Math.min(200, raw.length))
                .toLowerCase();
              if (head.includes("nfe") || head.includes("nfeproc")) {
                xmlContent = raw;
              } else {
                console.warn(
                  LOG,
                  JSON.stringify({
                    fase: "xml_corpo_suspeito",
                    chave_nfe_44: chave,
                    company_id: companyId,
                  }),
                );
              }
            }
            return { cab, chave, xmlContent };
          }),
        );

        for (const { cab, chave, xmlContent } of chunkWithXml) {
          const vnf = cab["versao"];
          const versaoNf =
            vnf !== undefined && vnf !== null && Number.isFinite(Number(vnf))
              ? Math.floor(Number(vnf))
              : null;
          const situacao =
            cab["situacao"] !== undefined && cab["situacao"] !== null
              ? String(cab["situacao"])
              : null;

          const { error: insErr } = await admin
            .from("focus_get_sync_nfe_staging")
            .insert({
              exec_id: execId,
              company_id: companyId,
              cnpj: cnpjDigits,
              chave_nfe: chave,
              versao_nf: versaoNf,
              situacao,
              nfe_completa: true,
              payload: cab,
              page_index: page,
              versao_query_used: versao,
              x_total_count_snapshot: xTotalCount,
              x_max_version_snapshot: xMaxVersion,
              xml_content: xmlContent,
            });
          if (insErr) {
            console.warn(LOG, "staging_insert", companyId, insErr.message);
          } else {
            notasEncontradas += 1;
          }
        }
      }

      // x-total-count == 0 → não há mais notas a consultar (regra Focus / pedido de produto).
      if (xTotalCount === 0) {
        break;
      }

      if (cabList.length === 0) {
        if (
          xMaxVersion != null &&
          Number.isFinite(xMaxVersion) &&
          xMaxVersion > versao
        ) {
          versao = xMaxVersion;
          continue;
        }
        break;
      }

      if (xMaxVersion === null || !Number.isFinite(xMaxVersion)) {
        break;
      }
      if (xMaxVersion === versao) {
        break;
      }
      versao = xMaxVersion;
    }

    const temposDeProcessamento = {
      focus_http_ms_por_busca: focusHttpMs,
      focus_http_ms_total: focusHttpMs.reduce((a, b) => a + b, 0),
      empresa_total_ms: Math.round(performance.now() - tCompany0),
      wall_total_ms_ate_agora: Math.round(performance.now() - tWall0),
    };

    if (notasEncontradas > 0) {
      const { data: existingJob, error: selJobErr } = await admin
        .from("focus_get_sync_nfe_interpret_jobs")
        .select("id,status")
        .eq("exec_id", execId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (selJobErr) {
        console.warn(LOG, "interpret_job_select", companyId, selJobErr.message);
      } else if (!existingJob?.id) {
        const { error: insJobErr } = await admin
          .from("focus_get_sync_nfe_interpret_jobs")
          .insert({
            exec_id: execId,
            company_id: companyId,
            status: "pending",
            onboarding: onboardingFlow,
          });
        if (insJobErr) {
          console.warn(LOG, "interpret_job_insert", companyId, insJobErr.message);
        }
      } else {
        const { error: updOnbErr } = await admin
          .from("focus_get_sync_nfe_interpret_jobs")
          .update({ onboarding: onboardingFlow })
          .eq("id", existingJob.id);
        if (updOnbErr) {
          console.warn(LOG, "interpret_job_onboarding", companyId, updOnbErr.message);
        }
      }
    }

    const linhaLog = {
      cnpj: cnpjDigits,
      notasEncontradas,
      quantasBuscasForamExecutadas: quantasBuscas,
      temposDeProcessamento,
      company_id: companyId,
      exec_id: execId,
    };
    console.log(LOG, JSON.stringify(linhaLog));

    detail.push({
      company_id: companyId,
      cnpj: cnpjDigits,
      ok: true,
      exec_id: execId,
      notasEncontradas,
      quantasBuscasForamExecutadas: quantasBuscas,
      temposDeProcessamento,
    });
  }

  return json({
    ok: true,
    exec_id: execId,
    detail,
    metrics: {
      empresas_processadas: eligible.length,
      wall_total_ms: Math.round(performance.now() - tWall0),
    },
  });
  } catch (e) {
    console.error(LOG, "unhandled_error", e);
    return json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});

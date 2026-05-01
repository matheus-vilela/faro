/**
 * Sincroniza NF-es recebidas via API Focus (/v2/nfes_recebidas), página a página usando o
 * cursor `versao`, faz download do XML (/v2/nfes_recebidas/CHAVE.xml) e delega ao mesmo fluxo
 * da importação em lote (`import_job_batches` → `process-import-job-batch`): despesas, itens,
 * recebimento, pendências de revisão e boletos por duplicatas no XML quando existirem.
 *
 * Agende a cada ~2 horas (ex.: Supabase Cron / pg_net) com POST e header:
 *   Authorization: Bearer <FOCUS_NFE_RECEBIDAS_CRON_SECRET>
 *
 * Secrets: SUPABASE_* (edge padrão), FOCUS_NFE_TOKEN, FOCUS_NFE_RECEBIDAS_CRON_SECRET,
 * opcional FOCUS_NFE_API_BASE (padrão https://api.focusnfe.com.br).
 *
 * Apenas cabeçalhos com **`situacao`: `"autorizada"`** (case-insensitive) e **`nfe_completa`: `true`**
 * são considerados para download de XML (resto entra em `ignorada_nao_autorizada` /
 * `ignorada_nfe_nao_completa` no resumo `xml_loop_resumo`).
 *
 * Downloads de XML usam espera sequencial (`FOCUS_NFE_XML_THROTTLE_MS`, padrão 450) + retry em
 * HTTP 429/502/503 (`Retry-After` ou backoff) para evitar saturar os limites da Focus.
 *
 * **Observabilidade:** cada execução gera um `exec_id` (uuid) presente nos logs JSON e na resposta
 * HTTP (`ok: true, exec_id, detail`). Nos logs Supabase procure por `[focus-sync-nfe-recebidas]` e campo
 * `fase` (ex.: `lista_focus_pagina`, `xml_transferido_focus_ok`, `batch_import_files_inseridos`).
 * Despesas e UPSERT são feitos apenas em **`process-import-job-batch`** — acompanhar `batch_id` e os
 * logs dessa função para confirmar `expenses`/itens criados após cada sync.
 *
 * **Disparar o processor:** após criar `import_job_batches` + `import_job_files`, faz-se `await`
 * `admin.functions.invoke('process-import-job-batch')` (service role). Em `config.toml`,
 * `process-import-job-batch` usa `verify_jwt = false` — a segurança fica na verificação de Bearer
 * igual ao service role ou sessão válida dentro do próprio processor.
 *
 * **Disparo manual (app):** POST com JWT do utilizador e body JSON
 * `{ "manual": true, "company_id": "<uuid>", "versao_inicial"?: number }` — `versao_inicial` opcional
 * (cursor Focus `versao`; se omitido usa `focusnfe.nfes_recebidas_ultima_versao` gravado).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[focus-sync-nfe-recebidas]";

/** Logs legíveis nos logs da Supabase Edge (filtrar por prefixo `[focus-sync-nfe-recebidas]`). */
function slog(
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

/** Marcadores grepável: `acao` estável + `unidade` = company_id (alinhado a process-import-job-batch). */
function marcador(unidadeId: string, acao: string, detalhes: Record<string, unknown>): void {
  console.log(LOG, JSON.stringify({ unidade: unidadeId, acao, ...detalhes }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

/** Milissegundos entre downloads de XML (evitar 429). Override: FOCUS_NFE_XML_THROTTLE_MS */
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
    if (Number.isFinite(w)) return Math.min(Math.max(0, Math.floor(w)), 300_000);
  }
  return null;
}

/**
 * Focus devolve HTTP 429 se abrirmos muitos GET de XML por segundo — retry exponencial +
 * Retry-After e espera sequencial entre chaves (throttleMsBetweenXmlDownloads).
 */
async function fetchNfeRecebidaXmlWithRetry(
  xmlUrl: string,
  focusToken: string,
  /** Chave de acesso NF-e completa (44 dígitos) — aparece assim nos logs para debug manual. */
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
        console.warn(
          LOG,
          JSON.stringify({
            fase: "xml_focus_rede_abort",
            chave_nfe_44: chaveNfe44,
            mensagem: "esgotaram-se as tentativas após erros de rede",
          }),
        );
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
      if (attempt === maxAttempts) {
        console.warn(
          LOG,
          JSON.stringify({
            fase: "xml_focus_429_abort",
            chave_nfe_44: chaveNfe44,
            mensagem: "esgotaram-se tentativas (rate limit Focus)",
          }),
        );
        return { ok: false, status: 429 };
      }
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

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input.slice());
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

function base64FromBytes(input: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < input.length; i += 1) {
    binary += String.fromCharCode(input[i]!);
  }
  return btoa(binary);
}

type NfeCab = {
  chave_nfe: string;
  versao?: number;
  situacao?: string;
  /** Focus: só importar quando `true` (NF-e completa na consulta). */
  nfe_completa?: boolean;
  nome_emitente?: string;
};

/** API Focus: `nfe_completa` como boolean `true` ou string `"true"`. */
function nfeCompletaTrue(cab: NfeCab): boolean {
  const raw = (cab as Record<string, unknown>).nfe_completa;
  if (raw === true) return true;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "true") return true;
  return false;
}

/** Só descarrega XML quando `situacao` = autorizada e `nfe_completa` = true. */
function nfeRecebidaImportavel(cab: NfeCab): boolean {
  return String(cab.situacao ?? "").toLowerCase() === "autorizada" &&
    nfeCompletaTrue(cab);
}

function focusIdEmpresa(raw: Record<string, unknown> | undefined): unknown {
  const v = raw?.id_empresa;
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const bodyRaw = await req.json().catch(() => ({}));
  const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
    ? (bodyRaw as Record<string, unknown>)
    : {};

  const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  if (!expected) {
    return json(
      {
        ok: false,
        error:
          "Defina FOCUS_NFE_RECEBIDAS_CRON_SECRET para agendamento seguro desta função.",
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
      {
        ok: false,
        error: "Variáveis Supabase ou FOCUS_NFE_TOKEN em falta.",
      },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  type CoRow = { id: string; document?: string | null; focusnfe?: Record<string, unknown> };
  let companiesToProcess: CoRow[] = [];
  let isManualSingle = false;
  let manualVersaoInicial: number | undefined = undefined;

  if (isCron) {
    const { data: companies, error: listErr } = await admin
      .from("companies")
      .select("id, document, focusnfe");

    if (listErr) {
      console.error(LOG, "list_companies", listErr.message);
      return json({ ok: false, error: listErr.message }, 500);
    }
    companiesToProcess = (companies ?? []) as CoRow[];
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
      return json({ ok: false, error: "manual: true requer company_id (UUID da unidade)." }, 400);
    }
    if (!authHeader.startsWith("Bearer ") || !bearer) {
      return json({ ok: false, error: "Envie Authorization: Bearer <JWT da sessão>." }, 401);
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
      return json({ ok: false, error: "Sessão inválida. Entre novamente." }, 401);
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
    const rawv = body.versao_inicial;
    if (rawv !== undefined && rawv !== null && String(rawv).trim() !== "") {
      const n = Number(rawv);
      if (Number.isFinite(n) && n >= 0) manualVersaoInicial = Math.floor(n);
    }
  }

  const execId = crypto.randomUUID();
  const iniciadoEm = new Date().toISOString();
  slog("execucao_inicio", null, "POST aceite; vai processar empresas", {
    exec_id: execId,
    api_base: apiBase,
    iniciado_em: iniciadoEm,
    modo: isCron ? "cron_todas" : "manual_unidade",
  });

  const listaCount = companiesToProcess.length;
  slog(
    "empresas_carregadas",
    null,
    `linhas a processar=${listaCount}`,
    { exec_id: execId, total: listaCount, manual: isManualSingle },
  );

  const summary: Array<Record<string, unknown>> = [];

  for (const row of companiesToProcess) {
    const companyId = String((row as { id: string }).id);
    const focusnfe = ((row as { focusnfe?: Record<string, unknown> })
      .focusnfe ?? {}) as Record<string, unknown>;
    if (!focusIdEmpresa(focusnfe)) {
      slog(
        "empresa_ignorada",
        companyId,
        "sem focusnfe.id_empresa",
        { exec_id: execId, motivo: "sem id_empresa Focus" },
      );
      summary.push({
        company_id: companyId,
        skipped: "sem id_empresa Focus",
      });
      continue;
    }

    const cnpjDigits = String((row as { document?: string }).document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);
    if (cnpjDigits.length !== 14) {
      slog(
        "empresa_ignorada",
        companyId,
        "CNPJ incompleto no cadastro",
        {
          exec_id: execId,
          motivo: "document sem CNPJ 14 dígitos",
          document_raw_len: String(
            (row as { document?: string }).document ?? "",
          ).length,
        },
      );
      summary.push({
        company_id: companyId,
        skipped: "document sem CNPJ 14 dígitos",
      });
      continue;
    }

    /** Cursor persistido no ciclo anterior; se não existir, a Focus trata como início em 0. */
    const storedRaw = Number(focusnfe.nfes_recebidas_ultima_versao);
    const cursorPersistido =
      Number.isFinite(storedRaw) && storedRaw >= 0 ? Math.floor(storedRaw) : 0;
    const cursor =
      isManualSingle && manualVersaoInicial !== undefined
        ? manualVersaoInicial
        : cursorPersistido;

    slog("empresa_inicio", companyId, "início ciclo NF-e recebidas", {
      exec_id: execId,
      cnpj: cnpjDigits,
      versao_cursor_inicial: cursor,
      versao_override_manual:
        isManualSingle && manualVersaoInicial !== undefined ? manualVersaoInicial : null,
      versao_persistida_sem_override: cursorPersistido,
      nfes_sync_anterior_iso: typeof focusnfe.nfes_recebidas_ultima_sync_at ===
          "string"
        ? focusnfe.nfes_recebidas_ultima_sync_at
        : null,
    });

    const { data: ownerRow } = await admin
      .from("user_companies")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .maybeSingle();

    let requestedBy: string | null = ownerRow?.user_id ?? null;
    if (!requestedBy) {
      const { data: anyMem } = await admin
        .from("user_companies")
        .select("user_id")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();
      requestedBy = anyMem?.user_id ?? null;
    }
    if (!requestedBy) {
      slog(
        "empresa_ignorada",
        companyId,
        "sem utilizador para requested_by no batch import",
        { exec_id: execId },
      );
      summary.push({
        company_id: companyId,
        skipped: "sem membro para requested_by no lote",
      });
      continue;
    }

    const pages: NfeCab[][] = [];
    let runs = 0;
    const MAX_RUNS = 40;

    while (runs++ < MAX_RUNS) {
      const cursorAntesLista = cursor;
      const listUrl = `${apiBase}/v2/nfes_recebidas?cnpj=${encodeURIComponent(cnpjDigits)}&versao=${cursor}`;

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
        slog("lista_focus_erro_rede", companyId, String(e), {
          exec_id: execId,
          run: runs,
        });
        summary.push({
          company_id: companyId,
          error: "falha de rede lista Focus",
        });
        break;
      }

      const listText = await listRes.text();
      let lista: unknown;
      try {
        lista = listText ? JSON.parse(listText) : [];
      } catch {
        console.warn(
          LOG,
          "JSON lista inválido",
          companyId,
          listText.slice(0, 220),
        );
        slog("lista_focus_json_invalido", companyId, "resposta não é JSON array", {
          exec_id: execId,
          run: runs,
          http_status: listRes.status,
          corpo_preview: listText.slice(0, 400),
        });
        summary.push({
          company_id: companyId,
          error: `HTTP ${listRes.status} lista NF-e`,
        });
        break;
      }

      if (!Array.isArray(lista)) {
        slog("lista_focus_formato", companyId, "JSON não é array", {
          exec_id: execId,
          run: runs,
          http_status: listRes.status,
        });
        summary.push({
          company_id: companyId,
          error: `resposta lista inesperada ${listRes.status}`,
        });
        break;
      }

      const hdrMaxRaw = listRes.headers.get("X-Max-Version");
      const hdrMax = hdrMaxRaw != null ? Number(hdrMaxRaw) : NaN;

      // Fim da paginação: lista vazia → não há mais NF-es com versão > cursor neste ciclo.
      if (lista.length === 0) {
        if (Number.isFinite(hdrMax) && hdrMax > cursor) {
          cursor = Math.floor(hdrMax);
        }
        slog("lista_focus_pagina", companyId, "página sem itens → fim listagem neste ciclo", {
          exec_id: execId,
          run: runs,
          http_status: listRes.status,
          itens_nesta_pagina: 0,
          versao_cursor_entrada: cursorAntesLista,
          versao_cursor_saida: cursor,
          x_max_version:
            Number.isFinite(hdrMax) ? Math.floor(hdrMax) : undefined,
        });
        pages.push([]);
        break;
      }

      const cabList = lista as NfeCab[];
      pages.push(cabList);

      let pageMaxVers = cursor;
      for (const cab of cabList) {
        const v = Number(cab.versao);
        if (Number.isFinite(v) && v > pageMaxVers) pageMaxVers = Math.floor(v);
      }
      if (Number.isFinite(hdrMax) && hdrMax > pageMaxVers) {
        pageMaxVers = Math.floor(hdrMax);
      }
      cursor = pageMaxVers;

      slog("lista_focus_pagina", companyId, `${cabList.length} cabeçalhos na página`, {
        exec_id: execId,
        run: runs,
        http_status: listRes.status,
        itens_nesta_pagina: cabList.length,
        proxima_consulta_versao: cursor,
        x_max_version:
          Number.isFinite(hdrMax) ? Math.floor(hdrMax) : undefined,
      });

      // Última página “cheia” (100 itens): nova consulta com versao = último visto.
      // Menos de 100: não há próxima página neste ciclo.
      if (lista.length < 100) break;
    }

    if (runs >= MAX_RUNS && pages.length > 0) {
      const lastLen = pages[pages.length - 1]?.length ?? 0;
      if (lastLen === 100) {
        slog(
          "lista_focus_aviso",
          companyId,
          `atenção: atingiu MAX_RUNS=${MAX_RUNS}; pode faltar paginação`,
          { exec_id: execId },
        );
      }
    }

    const allCabs = pages.flat();

    const chavesCandidatos = [
      ...new Set(
        allCabs
          .map((c) => String(c.chave_nfe ?? "").replace(/\D/g, ""))
          .filter((c) => c.length === 44),
      ),
    ];
    const importaveisCount = allCabs.filter((c) => {
      const ch = String(c.chave_nfe ?? "").replace(/\D/g, "");
      return ch.length === 44 && nfeRecebidaImportavel(c);
    }).length;

    const keysKnown = new Set<string>();
    if (chavesCandidatos.length > 0) {
      const chunk = 120;
      for (let i = 0; i < chavesCandidatos.length; i += chunk) {
        const part = chavesCandidatos.slice(i, i + chunk);
        const { data: existingKeys } = await admin
          .from("company_nfe_import_logs")
          .select("nfe_access_key")
          .eq("company_id", companyId)
          .in("nfe_access_key", part);
        for (const r of existingKeys ?? []) {
          const k = (r as { nfe_access_key?: string }).nfe_access_key;
          if (k) keysKnown.add(k);
        }
      }
    }

    slog(
      "apos_listagem_resumo",
      companyId,
      "totais antes de transferir XML",
      {
        exec_id: execId,
        total_cabecalhos_na_resposta_focus: allCabs.length,
        chaves_distintas_44_chars: chavesCandidatos.length,
        cabecalhos_autorizada_e_nfe_completa: importaveisCount,
        ja_existentes_em_company_nfe_import_logs: keysKnown.size,
        paginas_nfes_recebidas_processadas: pages.length,
      },
    );

    /** Autorizada + `nfe_completa` e ainda não importada (chave). */
    const toFetch: Array<{ cab: NfeCab; xml: Uint8Array; hash: string }> = [];
    const xmlGapMs = throttleMsBetweenXmlDownloads();
    let xmlFetchIndex = 0;
    /** Lista Focus pode repetir cabeçalhos entre páginas — evita dois XML com o mesmo hash no batch. */
    const seenChaveThisCycle = new Set<string>();
    const seenXmlHashThisBatch = new Set<string>();

    const xmlPasso = {
      linhas_na_listagem: 0,
      ignorada_chave_invalida: 0,
      ignorada_nao_autorizada: 0,
      ignorada_nfe_nao_completa: 0,
      ignorada_ja_importada_na_base: 0,
      ignorada_duplicada_na_mesma_listagem: 0,
      falha_download_ou_focus: 0,
      corpo_sem_marcacao_nfe: 0,
      ignorada_xml_hash_duplicado_no_batch: 0,
      xml_descarregado_ok: 0,
    };

    for (const cab of allCabs) {
      xmlPasso.linhas_na_listagem += 1;
      const chave = String(cab.chave_nfe ?? "").replace(/\D/g, "");
      if (chave.length !== 44) {
        xmlPasso.ignorada_chave_invalida += 1;
        continue;
      }
      const sit = String(cab.situacao ?? "").toLowerCase();
      if (sit !== "autorizada") {
        xmlPasso.ignorada_nao_autorizada += 1;
        continue;
      }
      if (!nfeCompletaTrue(cab)) {
        xmlPasso.ignorada_nfe_nao_completa += 1;
        continue;
      }

      if (keysKnown.has(chave)) {
        xmlPasso.ignorada_ja_importada_na_base += 1;
        continue;
      }
      if (seenChaveThisCycle.has(chave)) {
        xmlPasso.ignorada_duplicada_na_mesma_listagem += 1;
        continue;
      }

      if (xmlFetchIndex++ > 0 && xmlGapMs > 0) await sleep(xmlGapMs);

      const xmlUrl =
        `${apiBase}/v2/nfes_recebidas/${encodeURIComponent(chave)}.xml?cnpj=${encodeURIComponent(cnpjDigits)}`;
      const got = await fetchNfeRecebidaXmlWithRetry(
        xmlUrl,
        focusToken,
        chave,
      );
      if (!got.ok) {
        xmlPasso.falha_download_ou_focus += 1;
        if (got.status !== 429) {
          console.warn(
            LOG,
            `xml falhou HTTP ${got.status} chave=${chave}`,
          );
        }
        continue;
      }

      const xmlBuf = got.buf;
      const head = new TextDecoder()
        .decode(xmlBuf.subarray(0, Math.min(200, xmlBuf.length)))
        .toLowerCase();
      if (!(head.includes("nfe") || head.includes("nfeproc"))) {
        xmlPasso.corpo_sem_marcacao_nfe += 1;
        slog("xml_sem_nfe_proc", companyId, "bytes recebidos mas cabeçalho não parece NF-e", {
          exec_id: execId,
          chave_nfe_44: chave,
          bytes: xmlBuf.length,
          preview_ascii: String(
            new TextDecoder().decode(
              xmlBuf.subarray(0, Math.min(120, xmlBuf.length)),
            ),
          ).replace(/\s+/g, " "),
        });
        continue;
      }

      const h = await sha256Hex(xmlBuf);
      if (seenXmlHashThisBatch.has(h)) {
        xmlPasso.ignorada_xml_hash_duplicado_no_batch += 1;
        slog("xml_duplicado_mesmo_hash_no_batch", companyId, "mesmo SHA-256 que outro ficheiro deste ciclo — ignora segunda chave", {
          exec_id: execId,
          chave_nfe_44: chave,
          sha256_prefix: `${h.slice(0, 12)}…`,
        });
        seenChaveThisCycle.add(chave);
        continue;
      }

      xmlPasso.xml_descarregado_ok += 1;
      slog(
        "xml_transferido_focus_ok",
        companyId,
        "XML guardado para fila de import batch",
        {
          exec_id: execId,
          chave_nfe_44: chave,
          bytes: xmlBuf.length,
          indice_na_fila: toFetch.length + 1,
        },
      );

      seenChaveThisCycle.add(chave);
      seenXmlHashThisBatch.add(h);
      toFetch.push({ cab, xml: xmlBuf, hash: h });
    }

    slog(
      "xml_loop_resumo",
      companyId,
      "panorama transferência Focus → Faro neste ciclo",
      {
        exec_id: execId,
        throttle_ms_entre_pedidos: xmlGapMs,
        ...xmlPasso,
        fila_import_job_este_batch: toFetch.length,
      },
    );

    let batchIdOut: string | null = null;
    let filesInserted = 0;

    if (toFetch.length === 0) {
      slog(
        "batch_import_pulado",
        companyId,
        "zero ficheiros novos para import_job_batches (nada a despachar para process-import-job-batch)",
        { exec_id: execId },
      );
    }

    if (toFetch.length > 0) {
      const { data: batchRow, error: batchErr } = await admin
        .from("import_job_batches")
        .insert({
          company_id: companyId,
          requested_by: requestedBy,
          source_file_name: `focus_nfes_recebidas_${new Date().toISOString()}`,
          status: "QUEUED",
          total_files: toFetch.length,
          processed_files: 0,
          success_files: 0,
          failed_files: 0,
          pending_review_files: 0,
          progress_percent: 0,
        })
        .select("id")
        .single();

      if (batchErr || !batchRow?.id) {
        console.error(LOG, "batch_insert", batchErr?.message ?? "null");
        slog("batch_import_erro_inserir", companyId, batchErr?.message ?? "batch null", {
          exec_id: execId,
        });
        summary.push({
          company_id: companyId,
          error: batchErr?.message ?? "batch",
        });
        continue;
      }
      batchIdOut = String(batchRow.id);
      slog(
        "batch_import_criado",
        companyId,
        "linha insert import_job_batches OK",
        {
          exec_id: execId,
          batch_id: batchIdOut,
          total_files: toFetch.length,
          source: "focus_nfes_recebidas",
        },
      );

      const fileRows = toFetch.map(({ cab, xml, hash }) => ({
        batch_id: batchIdOut,
        company_id: companyId,
        file_name: `${cab.chave_nfe}.xml`,
        xml_hash: hash,
        xml_content_base64: base64FromBytes(xml),
        status: "QUEUED",
      }));

      const { error: filesErr } = await admin
        .from("import_job_files")
        .insert(fileRows);
      if (filesErr) {
        console.error(LOG, "files_insert", filesErr.message);
        slog("batch_import_erro_files", companyId, filesErr.message, {
          exec_id: execId,
          batch_id: batchIdOut,
          tentados: fileRows.length,
        });
        await admin
          .from("import_job_batches")
          .update({
            status: "FAILED",
            last_error: filesErr.message,
            finished_at: new Date().toISOString(),
          })
          .eq("id", batchIdOut);
        summary.push({
          company_id: companyId,
          error: filesErr.message,
        });
        continue;
      }
      filesInserted = toFetch.length;

      slog(
        "batch_import_files_inseridos",
        companyId,
        `${filesInserted} linhas em import_job_files (antes de despachar processador)`,
        { exec_id: execId, batch_id: batchIdOut, filesInserted },
      );

      /**
       * `await` + `admin.functions.invoke` garante que a **primeira** ronda do processor executa
       * antes do sync devolver (evita encerramento prematuro do isolate). Mais ficheiros:
       * até `MAX_FILES_PER_RUN` por invoke (quota CPU da Edge) + encadeamento no próprio `process-import-job-batch`.
       */
      marcador(companyId, "FOCUS_SYNC_LOTE_ENFILEIRADO", {
        batch_id: batchIdOut,
        arquivos: filesInserted,
        exec_id: execId,
      });
      slog(
        "process_import_job_batch_ANTES_INVOKE",
        companyId,
        "await admin.functions.invoke(process-import-job-batch)",
        {
          exec_id: execId,
          batch_id: batchIdOut,
          nota: "config.toml: process-import-job-batch com verify_jwt=false + auth no handler",
        },
      );

      const { data: procData, error: procErr } = await admin.functions.invoke(
        "process-import-job-batch",
        { body: { batch_id: batchIdOut } },
      );

      if (procErr) {
        const errMsg = procErr.message ?? String(procErr);
        marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_ERRO", {
          batch_id: batchIdOut,
          exec_id: execId,
          erro: errMsg,
        });
        console.error(
          LOG,
          JSON.stringify({
            fase: "process_import_job_batch_invoke_ERRO",
            empresa: companyId,
            batch_id: batchIdOut,
            exec_id: execId,
            erro: errMsg,
          }),
        );
        slog(
          "process_import_job_batch_invoke_ERRO",
          companyId,
          "invoke devolveu erro — batch pode ficar QUEUED",
          {
            exec_id: execId,
            batch_id: batchIdOut,
            erro: errMsg,
          },
        );
      } else {
        marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_OK", {
          batch_id: batchIdOut,
          exec_id: execId,
        });
        slog(
          "process_import_job_batch_invoke_OK",
          companyId,
          "processor respondeu na integra (1ª ronda); se remaining_files>0 encadeamento interno continua no processor",
          {
            exec_id: execId,
            batch_id: batchIdOut,
            resposta_processor: procData ?? null,
          },
        );
      }

      slog(
        "proxima_etapa_manual",
        companyId,
        "revisão de despesas: import_job_files.status, company_nfe_import_logs, expenses — e logs edge process-import-job-batch",
        { exec_id: execId, batch_id: batchIdOut },
      );
    }

    const proximaSyncAt = new Date().toISOString();
    const nextFocus: Record<string, unknown> = {
      ...focusnfe,
      nfes_recebidas_ultima_sync_at: proximaSyncAt,
      nfes_recebidas_ultima_versao: cursor,
    };
    const { error: upErr } = await admin
      .from("companies")
      .update({
        focusnfe: nextFocus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId);
    if (upErr) {
      console.warn(LOG, "cursor_persist_falhou", companyId, upErr.message);
      slog("cursor_persist_erro", companyId, upErr.message, {
        exec_id: execId,
      });
    } else {
      slog(
        "cursor_persist_ok",
        companyId,
        "focusnfe.nfes_recebidas atualizado para próximo cron",
        {
          exec_id: execId,
          nfes_recebidas_ultima_versao: cursor,
          nfes_recebidas_ultima_sync_at: proximaSyncAt,
        },
      );
    }

    const linhaSumario = {
      company_id: companyId,
      cnpj: cnpjDigits,
      cabecalhos_na_api: allCabs.length,
      novos_xml_na_fila: toFetch.length,
      batch_id: batchIdOut,
      arquivos_inseridos: filesInserted,
      cursor_versao_armazenar: cursor,
    };
    summary.push(linhaSumario);

    slog(
      "empresa_fim_resumo_linha",
      companyId,
      "fim processamento empresa neste POST",
      { exec_id: execId, ...linhaSumario },
    );
  }

  slog(
    "execucao_fim",
    null,
    `concluído; ${summary.length} entradas no array detail da resposta JSON`,
    {
      exec_id: execId,
      empresas_no_detail: summary.length,
      iniciado_em: iniciadoEm,
      terminado_em: new Date().toISOString(),
    },
  );

  console.log(LOG, `${JSON.stringify({ exec_id: execId, resultado_resumo_json: summary })}`);

  return json({
    ok: true,
    exec_id: execId,
    companies: summary.length,
    detail: summary,
  });
});

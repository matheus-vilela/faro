/**
 * Handler POST da sincronização NF-e recebidas (Focus).
 *
 * Etapas (visão linear):
 * 1. Body + env + caps (`phase`, limites manuais, `skip_process_import_job_batch`).
 * 2. Resolução de empresas (cron multi-unidade vs manual com JWT + `user_companies`).
 * 3. Filtro de elegíveis (`id_empresa`, CNPJ, `maxCompanies`).
 * 4. Por unidade: lease (cron), cursor, `requested_by`, fase list (API + fila) e/ou download (claim + XML + batch).
 * 5. Persistência de cursor/lease e sumário.
 * 6. Encadeamento opcional (`waitUntil(fetch)` para esta mesma função) quando há trabalho pendente.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY,
  isVerboseLogs,
  LOG,
  QUEUE_MAX_ATTEMPTS_FAIL,
} from "./constants.ts";
import { base64FromBytes, sha256Hex } from "./encoding.ts";
import {
  fetchNfeRecebidaXmlWithRetry,
  focusBasicAuthHeader,
  throttleMsForSyncRun,
} from "./focus_xml.ts";
import { intFromEnv, json, optionalBodyInt, sleep } from "./http.ts";
import { marcador, slog, slogV } from "./log.ts";
import {
  budgetExceeded,
  focusIdEmpresa,
  limitCabListForManualTest,
  listFocusPageIsFull,
  parseCabTotal,
  parsePhase,
} from "./nfe_cab.ts";
import {
  countPendingQueue,
  kickProcessImportJobBatch,
  persistFocusnfe,
  scheduleWaitUntil,
} from "./supabase_ops.ts";
import type { CoRow, NfeCab, QueueRow } from "./types.ts";

export async function handleFocusSyncPost(req: Request): Promise<Response> {
  // === 1. Body, segredo cron, Supabase, Focus e caps (env + overrides manuais) ===
  const bodyRaw = await req.json().catch(() => ({}));
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
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

  const maxCompanies = intFromEnv(
    "FOCUS_SYNC_MAX_COMPANIES_PER_RUN",
    1,
    1,
    500,
  );
  let maxListPages = intFromEnv("FOCUS_SYNC_MAX_LIST_PAGES", 8, 1, 80);
  let maxXmlDownloads = intFromEnv(
    "FOCUS_SYNC_MAX_XML_DOWNLOADS_PER_RUN",
    20,
    1,
    500,
  );
  const softBudgetMs = intFromEnv("FOCUS_SYNC_SOFT_BUDGET_MS", 0, 0, 600_000);
  const leaseMinutes = intFromEnv("FOCUS_SYNC_LEASE_MINUTES", 30, 1, 180);
  const activeBatchStaleMinutes = intFromEnv(
    "FOCUS_SYNC_ACTIVE_BATCH_STALE_MINUTES",
    25,
    5,
    24 * 60,
  );
  let maxChainDepth = intFromEnv("FOCUS_SYNC_MAX_CHAIN_DEPTH", 2, 0, 5);
  let listPageSize = intFromEnv("FOCUS_SYNC_LIST_PAGE_SIZE", 25, 1, 100);

  const phase = parsePhase(body.phase);
  const skipProcessImportJobBatch = body.skip_process_import_job_batch === true;
  const chainDepthReal = Number.isFinite(Number(body.chain_depth))
    ? Math.max(0, Math.floor(Number(body.chain_depth)))
    : 0;

  const cronFilterCompanyId = isCron
    ? String(body.company_id ?? "").trim()
    : "";

  const chainAuthHeader = isCron ? `Bearer ${expected}` : authHeader;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // === 2. Lista de unidades a processar (cron multi-unidade vs manual + sessão) ===
  let companiesToProcess: CoRow[] = [];
  let isManualSingle = false;
  let manualVersaoInicial: number | undefined = undefined;
  let manualForceReimport = false;
  let manualTestMode = false;
  let manualTestSingleKey: string | null = null;

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
    const rawv = body.versao_inicial;
    if (rawv !== undefined && rawv !== null && String(rawv).trim() !== "") {
      const n = Number(rawv);
      if (Number.isFinite(n) && n >= 0) manualVersaoInicial = Math.floor(n);
    }
    manualForceReimport = body.force_reimport === true;
    manualTestMode = body.test_mode === true;
    const maybeTestKey = String(body.test_single_key ?? "").replace(/\D/g, "");
    manualTestSingleKey = maybeTestKey.length === 44 ? maybeTestKey : null;
  }

  if (isManualSingle) {
    const oLp = optionalBodyInt(body.max_list_pages, 1, 80);
    if (oLp !== null) maxListPages = oLp;
    const oXd = optionalBodyInt(body.max_xml_downloads, 1, 500);
    if (oXd !== null) maxXmlDownloads = oXd;
    const oCh = optionalBodyInt(body.max_chain_depth, 0, 5);
    if (oCh !== null) maxChainDepth = oCh;
    const oLps = optionalBodyInt(body.list_page_size, 1, 100);
    if (oLps !== null) listPageSize = oLps;
    if (manualTestMode) {
      maxListPages = 1;
      maxXmlDownloads = 1;
      maxChainDepth = 0;
    }
  }

  // === 3. Elegíveis: id_empresa Focus, CNPJ 14 dígitos, limite `maxCompanies` ===
  const summary: Array<Record<string, unknown>> = [];

  const eligibleLimited: CoRow[] = [];
  let eligibleSlots = 0;
  for (const row of companiesToProcess) {
    const companyId = String(row.id);
    const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);
    if (!focusIdEmpresa(focusnfe)) {
      summary.push({
        company_id: companyId,
        skipped: "sem id_empresa Focus",
      });
      continue;
    }
    if (cnpjDigits.length !== 14) {
      summary.push({
        company_id: companyId,
        skipped: "document sem CNPJ 14 dígitos",
      });
      continue;
    }
    if (eligibleSlots >= maxCompanies) continue;
    eligibleSlots += 1;
    eligibleLimited.push(row);
  }
  companiesToProcess = eligibleLimited;

  // === 4. Por unidade: lease (cron), lista Focus + fila, claim + XML + `import_job_*` ===
  const execId = crypto.randomUUID();
  const iniciadoEm = new Date().toISOString();
  const t0 = performance.now();

  slog("execucao_inicio", null, "POST aceite", {
    exec_id: execId,
    api_base: apiBase,
    iniciado_em: iniciadoEm,
    modo: isCron ? "cron" : "manual_unidade",
    phase,
    caps: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
      leaseMinutes,
      maxChainDepth,
    },
    chain_depth: chainDepthReal,
  });

  let totalPaginas = 0;
  let totalCabecalhos = 0;
  let totalEnfileirados = 0;
  let totalXmlOk = 0;
  let listaIncompletaGlobal = false;
  let pendingAfterGlobal = 0;

  for (const row of companiesToProcess) {
    const companyId = String(row.id);
    let focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);

    const leaseIso =
      typeof focusnfe.nfes_recebidas_sync_lease_until === "string"
        ? focusnfe.nfes_recebidas_sync_lease_until
        : "";
    if (!isManualSingle && leaseIso) {
      const t = Date.parse(leaseIso);
      if (Number.isFinite(t) && t > Date.now()) {
        slog("empresa_ignorada_lease", companyId, "lease ativo", {
          exec_id: execId,
          ate: leaseIso,
        });
        summary.push({
          company_id: companyId,
          skipped: "lease ativo (outra execução cron)",
          nfes_recebidas_sync_lease_until: leaseIso,
        });
        continue;
      }
    }

    const storedRaw = Number(focusnfe.nfes_recebidas_ultima_versao);
    const cursorPersistido =
      Number.isFinite(storedRaw) && storedRaw >= 0 ? Math.floor(storedRaw) : 0;
    let cursor =
      isManualSingle && manualVersaoInicial !== undefined
        ? manualVersaoInicial
        : cursorPersistido;

    slogV("empresa_inicio", companyId, "início", {
      exec_id: execId,
      cnpj: cnpjDigits,
      versao_cursor_inicial: cursor,
      phase,
    });

    let requestedBy: string | null = ownerRow?.user_id ?? null;

    if (!isManualSingle) {
      const leaseUntil = new Date(
        Date.now() + leaseMinutes * 60_000,
      ).toISOString();
      await persistFocusnfe(
        admin,
        companyId,
        { nfes_recebidas_sync_lease_until: leaseUntil },
        execId,
        "lease_inicio",
      );
      focusnfe = { ...focusnfe, nfes_recebidas_sync_lease_until: leaseUntil };
    }

    const runList = phase === "list" || phase === "auto";
    const runDownload = phase === "download" || phase === "auto";

    let paginasEste = 0;
    let cabecalhosEste = 0;
    let enfileiradosEste = 0;
    let reativadosFilaEste = 0;
    let bloqueadosBatchAtivoEste = 0;
    let cabecalhosImportaveisEste = 0;
    let descartadosJaImportadosEste = 0;
    const xmlsIdentificadosEste: Array<Record<string, unknown>> = [];
    let listaIncompleta = false;
    let listError: string | null = null;
    const tList0 = performance.now();

    const seenChaveListCycle = new Set<string>();

    if (runList && manualTestMode && manualTestSingleKey) {
      const testKey = manualTestSingleKey;
      const seenChaveListCycle = new Set<string>();
      const toEnqueue: Array<{ chave: string; versao: number | null }> = [];
      if (!seenChaveListCycle.has(testKey)) {
        seenChaveListCycle.add(testKey);
        toEnqueue.push({ chave: testKey, versao: null });
      }
      cabecalhosImportaveisEste += toEnqueue.length;
      cabecalhosEste += toEnqueue.length;
      totalCabecalhos += toEnqueue.length;
      if (toEnqueue.length > 0) {
        const rows = toEnqueue.map((x) => ({
          company_id: companyId,
          nfe_access_key: x.chave,
          versao: x.versao,
          status: "pending",
        }));
        let inserted = 0;
        for (const rowToInsert of rows) {
          const { error: insErr } = await admin
            .from("focus_nfe_recebidas_sync_queue")
            .insert(rowToInsert);
          if (!insErr) inserted += 1;
          else if (
            !String(insErr.message).toLowerCase().includes("duplicate") &&
            insErr.code !== "23505"
          ) {
            console.warn(LOG, "queue_insert_test_mode", insErr.message);
          }
        }
        enfileiradosEste += inserted;
        totalEnfileirados += inserted;
      }
      slogV(
        "test_mode_single_key_queue",
        companyId,
        "chave única enfileirada para teste",
        {
          exec_id: execId,
          chave_nfe_44: testKey,
          enfileirados: enfileiradosEste,
        },
      );
    } else if (runList) {
      let runs = 0;
      while (runs < maxListPages) {
        if (budgetExceeded(t0, softBudgetMs)) {
          slog(
            "orcamento_soft_stop",
            companyId,
            "FOCUS_SYNC_SOFT_BUDGET_MS (list)",
            {
              exec_id: execId,
            },
          );
          listaIncompleta = true;
          break;
        }

        runs += 1;
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
          listError = "falha de rede lista Focus";
          break;
        }

        const listText = await listRes.text();
        let lista: unknown;
        try {
          lista = listText ? JSON.parse(listText) : [];
        } catch {
          listError = `HTTP ${listRes.status} lista NF-e (JSON inválido)`;
          break;
        }

        if (!Array.isArray(lista)) {
          listError = `resposta lista inesperada ${listRes.status}`;
          break;
        }

        const hdrMaxRaw = listRes.headers.get("X-Max-Version");
        const hdrMax = hdrMaxRaw != null ? Number(hdrMaxRaw) : NaN;

        if (lista.length === 0) {
          if (Number.isFinite(hdrMax) && hdrMax > cursor) {
            cursor = Math.floor(hdrMax);
          }
          paginasEste += 1;
          totalPaginas += 1;
          await persistFocusnfe(
            admin,
            companyId,
            {
              nfes_recebidas_ultima_versao: cursor,
            },
            execId,
            "checkpoint_lista_vazia",
          );
          slogV("lista_focus_pagina", companyId, "página vazia — fim", {
            exec_id: execId,
            run: runs,
            versao_cursor_saida: cursor,
          });
          break;
        }

        const cabList = lista as NfeCab[];
        const cabListForQueue = limitCabListForManualTest(cabList, {
          isManualSingle,
          manualTestMode,
          manualTestSingleKey,
          maxImportable: maxXmlDownloads,
        });
        paginasEste += 1;
        totalPaginas += 1;
        cabecalhosEste += cabList.length;
        totalCabecalhos += cabList.length;

        let pageMaxVers = cursor;
        for (const cab of cabList) {
          const v = Number(cab.versao);
          if (Number.isFinite(v) && v > pageMaxVers)
            pageMaxVers = Math.floor(v);
        }
        if (Number.isFinite(hdrMax) && hdrMax > pageMaxVers) {
          pageMaxVers = Math.floor(hdrMax);
        }
        cursor = pageMaxVers;

        await persistFocusnfe(
          admin,
          companyId,
          { nfes_recebidas_ultima_versao: cursor },
          execId,
          "checkpoint_lista_pagina",
        );

        slogV(
          "lista_focus_pagina",
          companyId,
          manualTestMode && isManualSingle && !manualTestSingleKey
            ? `página Focus ${cabList.length} itens → fila ${cabListForQueue.length} importável(is) (cap teste=${maxXmlDownloads})`
            : `${cabList.length} cabeçalhos`,
          {
            exec_id: execId,
            run: runs,
            proxima_consulta_versao: cursor,
            itens_pagina_focus: cabList.length,
            cabecalhos_para_enfileiramento: cabListForQueue.length,
          },
        );

        const toEnqueue: Array<{ chave: string; versao: number | null }> = [];
        for (const cab of cabListForQueue) {
          const chave = String(cab.chave_nfe ?? "").replace(/\D/g, "");
          if (chave.length !== 44) continue;
          if (!nfeRecebidaImportavel(cab)) continue;
          cabecalhosImportaveisEste += 1;
          if (xmlsIdentificadosEste.length < 80) {
            xmlsIdentificadosEste.push({
              chave_nfe: chave,
              versao: Number.isFinite(Number(cab.versao))
                ? Number(cab.versao)
                : null,
              situacao: String(cab.situacao ?? "").trim() || null,
              fornecedor_nome: String(cab.nome_emitente ?? "").trim() || null,
              valor_total: parseCabTotal(cab),
            });
          }
          if (seenChaveListCycle.has(chave)) continue;
          seenChaveListCycle.add(chave);
          const v = Number(cab.versao);
          toEnqueue.push({
            chave,
            versao: Number.isFinite(v) ? Math.floor(v) : null,
          });
        }

        if (toEnqueue.length > 0) {
          const chaves = toEnqueue.map((x) => x.chave);
          const keysKnown = new Set<string>();
          if (!(isManualSingle && manualForceReimport)) {
            const chunkSz = 120;
            for (let i = 0; i < chaves.length; i += chunkSz) {
              const part = chaves.slice(i, i + chunkSz);
              const { data: existingKeys } = await admin
                .from("company_nfe_import_logs")
                .select("nfe_access_key, expense_id")
                .eq("company_id", companyId)
                .in("nfe_access_key", part);
              const expenseIds = (existingKeys ?? [])
                .map((r) =>
                  String(
                    (r as { expense_id?: string | null }).expense_id ?? "",
                  ).trim(),
                )
                .filter((x) => x.length > 0);
              const existingExpenseIds = new Set<string>();
              if (expenseIds.length > 0) {
                const { data: expRows } = await admin
                  .from("expenses")
                  .select("id")
                  .eq("company_id", companyId)
                  .in("id", expenseIds);
                for (const er of expRows ?? []) {
                  const id = String((er as { id?: string }).id ?? "").trim();
                  if (id) existingExpenseIds.add(id);
                }
              }
              for (const r of existingKeys ?? []) {
                const row = r as {
                  nfe_access_key?: string;
                  expense_id?: string | null;
                };
                const k = row.nfe_access_key;
                if (!k) continue;
                // Só bloqueia quando a despesa ainda existe de fato.
                const expId = String(row.expense_id ?? "").trim();
                if (expId && existingExpenseIds.has(expId)) {
                  keysKnown.add(k);
                }
              }
            }
          }

          const rows = toEnqueue
            .filter((x) => !keysKnown.has(x.chave))
            .map((x) => ({
              company_id: companyId,
              nfe_access_key: x.chave,
              versao: x.versao,
              status: "pending",
            }));
          descartadosJaImportadosEste += toEnqueue.length - rows.length;

          // Alguns itens podem já existir na fila com estados terminais (ex.: failed/skipped_duplicate)
          // e nunca mais voltar para claim. Reativamos para pending quando apropriado.
          const rowsByKey = new Map(rows.map((r) => [r.nfe_access_key, r]));
          const rowsKeys = [...rowsByKey.keys()];
          if (rowsKeys.length > 0) {
            const batchActivityCache = new Map<string, boolean>();
            const { data: queueExisting } = await admin
              .from("focus_nfe_recebidas_sync_queue")
              .select("id, nfe_access_key, status, batch_id")
              .eq("company_id", companyId)
              .in("nfe_access_key", rowsKeys);

            for (const ex of queueExisting ?? []) {
              const q = ex as {
                id: string;
                nfe_access_key?: string;
                status?: string;
                batch_id?: string | null;
              };
              const key = String(q.nfe_access_key ?? "").trim();
              if (!key) continue;
              const st = String(q.status ?? "").toLowerCase();
              // Não mexe em itens realmente ativos.
              if (st === "pending" || st === "processing") {
                rowsByKey.delete(key);
                continue;
              }
              if (st === "in_batch") {
                const bid = String(q.batch_id ?? "").trim();
                if (bid) {
                  const { data: batchRow } = await admin
                    .from("import_job_batches")
                    .select("status, updated_at, created_at")
                    .eq("id", bid)
                    .maybeSingle();
                  const bst = String(batchRow?.status ?? "").toUpperCase();
                  const batchAtivo = bst === "QUEUED" || bst === "PROCESSING";
                  const tUpdated = Date.parse(
                    String(batchRow?.updated_at ?? ""),
                  );
                  const tCreated = Date.parse(
                    String(batchRow?.created_at ?? ""),
                  );
                  const tBase = Number.isFinite(tUpdated)
                    ? tUpdated
                    : Number.isFinite(tCreated)
                      ? tCreated
                      : NaN;
                  const activeAgeMs = Number.isFinite(tBase)
                    ? Date.now() - tBase
                    : 0;
                  const ativoMasStale =
                    batchAtivo &&
                    activeAgeMs > activeBatchStaleMinutes * 60_000;
                  let batchTemArquivosAtivos = false;
                  if (batchAtivo) {
                    if (batchActivityCache.has(bid)) {
                      batchTemArquivosAtivos =
                        batchActivityCache.get(bid) === true;
                    } else {
                      const { count: cActiveFiles } = await admin
                        .from("import_job_files")
                        .select("id", { count: "exact", head: true })
                        .eq("batch_id", bid)
                        .in("status", ["QUEUED", "PROCESSING"]);
                      batchTemArquivosAtivos = (cActiveFiles ?? 0) > 0;
                      batchActivityCache.set(bid, batchTemArquivosAtivos);
                    }
                  }
                  const ativoSemArquivos =
                    batchAtivo && !batchTemArquivosAtivos;
                  if (batchAtivo) {
                    if (ativoMasStale || ativoSemArquivos) {
                      slogV(
                        "queue_reactivate_stale_in_batch",
                        companyId,
                        "in_batch preso em batch ativo stale/inconsistente — reativar pending",
                        {
                          exec_id: execId,
                          batch_id: bid,
                          batch_status: bst,
                          active_age_ms: activeAgeMs,
                          stale_threshold_min: activeBatchStaleMinutes,
                          active_files: batchTemArquivosAtivos ? 1 : 0,
                          nfe_access_key: key,
                        },
                      );
                    } else {
                      bloqueadosBatchAtivoEste += 1;
                      rowsByKey.delete(key);
                      continue;
                    }
                  }
                  if (batchAtivo && !ativoMasStale && !ativoSemArquivos) {
                    bloqueadosBatchAtivoEste += 1;
                    rowsByKey.delete(key);
                    continue;
                  }
                }
              }
              const rowData = rowsByKey.get(key);
              const { error: reactErr } = await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "pending",
                  versao: rowData?.versao ?? null,
                  batch_id: null,
                  last_error: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", q.id);
              if (!reactErr) {
                reativadosFilaEste += 1;
                rowsByKey.delete(key);
              } else {
                console.warn(LOG, "queue_reactivate", reactErr.message);
              }
            }
          }

          const rowsToInsert = [...rowsByKey.values()];

          if (rowsToInsert.length > 0) {
            let inserted = 0;
            for (const row of rowsToInsert) {
              const { error: insErr } = await admin
                .from("focus_nfe_recebidas_sync_queue")
                .insert(row);
              if (!insErr) inserted += 1;
              else if (
                !String(insErr.message).toLowerCase().includes("duplicate") &&
                insErr.code !== "23505"
              ) {
                console.warn(LOG, "queue_insert", insErr.message);
              }
            }
            enfileiradosEste += inserted;
            totalEnfileirados += inserted;
          }
        }

        const listaLen = lista.length;
        if (
          listaLen < FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY &&
          listaLen !== listPageSize
        ) {
          break;
        }

        if (runs >= maxListPages) {
          listaIncompleta = listFocusPageIsFull(listaLen, listPageSize);
          if (listaIncompleta) {
            slogV(
              "lista_focus_cap",
              companyId,
              `MAX_LIST_PAGES=${maxListPages}`,
              {
                exec_id: execId,
              },
            );
          }
          break;
        }
      }
    }

    const elapsedListMs = Math.round(performance.now() - tList0);
    if (listError) {
      summary.push({ company_id: companyId, error: listError });
      await persistFocusnfe(
        admin,
        companyId,
        {
          nfes_recebidas_sync_lease_cleared: true,
        },
        execId,
        "lease_fim_erro_lista",
      );
      continue;
    }

    if (listaIncompleta) listaIncompletaGlobal = true;

    let batchIdOut: string | null = null;
    let filesInserted = 0;
    const tDl0 = performance.now();

    if (runDownload) {
      if (budgetExceeded(t0, softBudgetMs)) {
        slog("orcamento_soft_stop", companyId, "antes download", {
          exec_id: execId,
        });
      } else {
        const { data: claimed, error: claimErr } = await admin.rpc(
          "claim_focus_nfe_recebidas_queue",
          {
            p_company_id: companyId,
            p_limit: maxXmlDownloads,
          },
        );

        if (claimErr) {
          console.error(LOG, "claim_queue", claimErr.message);
          summary.push({
            company_id: companyId,
            error: `claim fila: ${claimErr.message}`,
          });
        } else {
          const claimedRows = (claimed ?? []) as QueueRow[];
          const claimedIds = claimedRows.map((r) => r.id);
          const settledQueueIds = new Set<string>();
          const xmlGapMs = throttleMsForSyncRun(manualTestMode);
          const toFetch: Array<{
            queueId: string;
            cab: NfeCab;
            xml: Uint8Array;
            hash: string;
          }> = [];
          const seenXmlHashThisBatch = new Set<string>();
          let xmlFetchIndex = 0;

          for (const qrow of claimedRows) {
            if (budgetExceeded(t0, softBudgetMs)) break;
            const chave = qrow.nfe_access_key;
            const cab: NfeCab = {
              chave_nfe: chave,
              versao: qrow.versao ?? undefined,
              situacao: "autorizada",
              nfe_completa: true,
            };

            if (xmlFetchIndex++ > 0 && xmlGapMs > 0) await sleep(xmlGapMs);

            const xmlUrl = `${apiBase}/v2/nfes_recebidas/${encodeURIComponent(chave)}.xml?cnpj=${encodeURIComponent(cnpjDigits)}`;
            const got = await fetchNfeRecebidaXmlWithRetry(
              xmlUrl,
              focusToken,
              chave,
            );
            if (!got.ok) {
              const failPending = qrow.attempt_count < QUEUE_MAX_ATTEMPTS_FAIL;
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: failPending ? "pending" : "failed",
                  last_error: `xml HTTP ${got.status}`,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }

            const xmlBuf = got.buf;
            const head = new TextDecoder()
              .decode(xmlBuf.subarray(0, Math.min(200, xmlBuf.length)))
              .toLowerCase();
            if (!(head.includes("nfe") || head.includes("nfeproc"))) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "failed",
                  last_error: "corpo não parece NF-e",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }

            const h = await sha256Hex(xmlBuf);
            if (seenXmlHashThisBatch.has(h)) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "skipped_duplicate",
                  last_error: "hash duplicado no batch",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }
            seenXmlHashThisBatch.add(h);
            totalXmlOk += 1;
            toFetch.push({ queueId: qrow.id, cab, xml: xmlBuf, hash: h });
            slogV("xml_transferido_focus_ok", companyId, "XML para batch", {
              exec_id: execId,
              chave_nfe_44: chave,
              bytes: xmlBuf.length,
            });
          }

          const toFetchIds = new Set(toFetch.map((t) => t.queueId));
          for (const qid of claimedIds) {
            if (!settledQueueIds.has(qid) && !toFetchIds.has(qid)) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "pending",
                  last_error: "interrompido (orçamento ou fim da fatia)",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qid)
                .eq("status", "processing");
            }
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
              for (const t of toFetch) {
                await admin
                  .from("focus_nfe_recebidas_sync_queue")
                  .update({
                    status: "pending",
                    last_error: batchErr?.message ?? "batch",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", t.queueId);
              }
              summary.push({
                company_id: companyId,
                error: batchErr?.message ?? "batch",
              });
            } else {
              batchIdOut = String(batchRow.id);
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
                await admin
                  .from("import_job_batches")
                  .update({
                    status: "FAILED",
                    last_error: filesErr.message,
                    finished_at: new Date().toISOString(),
                  })
                  .eq("id", batchIdOut);
                for (const t of toFetch) {
                  await admin
                    .from("focus_nfe_recebidas_sync_queue")
                    .update({
                      status: "pending",
                      last_error: filesErr.message,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", t.queueId);
                }
                summary.push({
                  company_id: companyId,
                  error: filesErr.message,
                });
                batchIdOut = null;
              } else {
                filesInserted = toFetch.length;
                const qids = toFetch.map((t) => t.queueId);
                await admin
                  .from("focus_nfe_recebidas_sync_queue")
                  .update({
                    status: "in_batch",
                    batch_id: batchIdOut,
                    updated_at: new Date().toISOString(),
                  })
                  .in("id", qids);

                marcador(companyId, "FOCUS_SYNC_LOTE_ENFILEIRADO", {
                  batch_id: batchIdOut,
                  arquivos: filesInserted,
                  exec_id: execId,
                });
                if (skipProcessImportJobBatch) {
                  slogV(
                    "process_import_job_batch_invoke_skip",
                    companyId,
                    "skip_process_import_job_batch=true — invoke do batch processor desativado",
                    { exec_id: execId, batch_id: batchIdOut },
                  );
                } else {
                  kickProcessImportJobBatch(
                    admin,
                    batchIdOut!,
                    companyId,
                    execId,
                    {
                      test_single_file: isManualSingle && manualTestMode,
                    },
                  );
                }
              }
            }
          }
        }
      }
    }

    const elapsedDownloadMs = Math.round(performance.now() - tDl0);
    const proximaSyncAt = new Date().toISOString();
    await persistFocusnfe(
      admin,
      companyId,
      {
        nfes_recebidas_ultima_sync_at: proximaSyncAt,
        nfes_recebidas_ultima_versao: cursor,
        nfes_recebidas_sync_lease_cleared: true,
      },
      execId,
      "lease_fim_ok",
    );

    const pendingRem = await countPendingQueue(admin, companyId);
    pendingAfterGlobal = pendingRem;

    const linhaSumario = {
      company_id: companyId,
      cnpj: cnpjDigits,
      phase,
      paginas_listadas: paginasEste,
      cabecalhos_vistos: cabecalhosEste,
      cabecalhos_importaveis: cabecalhosImportaveisEste,
      descartados_ja_importados: descartadosJaImportadosEste,
      filas_inseridas_este_ciclo: enfileiradosEste,
      filas_reativadas_este_ciclo: reativadosFilaEste,
      filas_bloqueadas_em_batch_ativo_este_ciclo: bloqueadosBatchAtivoEste,
      novos_xml_batch: filesInserted,
      batch_id: batchIdOut,
      cursor_versao: cursor,
      lista_incompleta: listaIncompleta,
      pending_queue_remaining: pendingRem,
      elapsed_ms_list: elapsedListMs,
      elapsed_ms_download: elapsedDownloadMs,
      xmls_identificados_preview: xmlsIdentificadosEste,
    };
    summary.push(linhaSumario);

    slogV("empresa_fim_resumo_linha", companyId, "fim", {
      exec_id: execId,
      ...linhaSumario,
    });
  }

  // === 5. Resumo global, encadeamento opcional (`waitUntil` + fetch) e resposta JSON ===
  const elapsedTotalMs = Math.round(performance.now() - t0);
  const singleCompanyId =
    companiesToProcess.length === 1 ? String(companiesToProcess[0]!.id) : "";

  const continuar =
    (listaIncompletaGlobal || pendingAfterGlobal > 0) &&
    chainDepthReal < maxChainDepth &&
    singleCompanyId !== "" &&
    (isManualSingle || cronFilterCompanyId !== "" || maxCompanies === 1);

  if (continuar) {
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/focus-sync-nfe-recebidas`;
    const chainBody = isCron
      ? {
          phase: "auto",
          company_id: singleCompanyId,
          chain_depth: chainDepthReal + 1,
        }
      : {
          manual: true,
          company_id: singleCompanyId,
          phase: "auto",
          chain_depth: chainDepthReal + 1,
        };
    const chainPromise = fetch(url, {
      method: "POST",
      headers: {
        Authorization: chainAuthHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chainBody),
    }).catch((e) => console.warn(LOG, "chain_fetch", String(e)));

    scheduleWaitUntil(chainPromise);
    slogV("continuacao_agendada", null, "waitUntil(chain POST)", {
      exec_id: execId,
      company_id: singleCompanyId,
      chain_depth_next: chainDepthReal + 1,
      is_manual_chain: !isCron,
    });
  }

  slog("execucao_fim", null, "concluído", {
    exec_id: execId,
    empresas_no_detail: summary.length,
    iniciado_em: iniciadoEm,
    terminado_em: new Date().toISOString(),
    elapsed_ms_total: elapsedTotalMs,
    totais: {
      paginas_listadas: totalPaginas,
      cabecalhos_vistos: totalCabecalhos,
      filas_inseridas: totalEnfileirados,
      xml_descarregados_ok: totalXmlOk,
    },
    caps_aplicados: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
    },
    continuacao: {
      lista_incompleta: listaIncompletaGlobal,
      pending_queue_remaining: pendingAfterGlobal,
      chain_scheduled: continuar,
      chain_depth_next: continuar ? chainDepthReal + 1 : null,
    },
  });

  if (isVerboseLogs()) {
    console.log(
      LOG,
      `${JSON.stringify({ exec_id: execId, resultado_resumo_json: summary })}`,
    );
  }

  return json({
    ok: true,
    exec_id: execId,
    companies: summary.length,
    detail: summary,
    metrics: {
      elapsed_ms_total: elapsedTotalMs,
      paginas_listadas: totalPaginas,
      cabecalhos_vistos: totalCabecalhos,
      filas_inseridas: totalEnfileirados,
      xml_descarregados_ok: totalXmlOk,
    },
    caps_aplicados: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
    },
    continuacao: {
      lista_incompleta: listaIncompletaGlobal,
      pending_queue_remaining: pendingAfterGlobal,
      chain_scheduled: continuar,
      mensagem:
        continuar || listaIncompletaGlobal || pendingAfterGlobal > 0
          ? "A sincronização pode continuar em chamadas seguintes (cron ou encadeamento automático)."
          : undefined,
    },
  });
}

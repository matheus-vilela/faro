/**
 * Sincroniza NF-es recebidas via API Focus (/v2/nfes_recebidas): listagem paginada (cursor `versao`),
 * enfileiramento em `focus_nfe_recebidas_sync_queue`, download assíncrono por fatias de XML e delegação
 * a `import_job_batches` → `process-import-job-batch`.
 *
 * **Fases (body `phase`):** `list` (só cabeçalhos + fila), `download` (só claim + XML + batch), `auto` (ambas, com orçamentos).
 * Default: `auto`. Cron sem body usa `auto`.
 *
 * **Orçamentos (env, opcionais):**
 * - `FOCUS_SYNC_MAX_COMPANIES_PER_RUN` (default 1) — cron processa no máximo N unidades elegíveis por POST.
 * - `FOCUS_SYNC_MAX_LIST_PAGES` (default 8) — páginas Focus GET por unidade por fase list.
 * - `FOCUS_SYNC_LIST_PAGE_SIZE` (default 25) — `limite` no GET lista; paginação trata também respostas com até 100 itens (teto histórico da API).
 * - `FOCUS_SYNC_MAX_XML_DOWNLOADS_PER_RUN` (default 20) — XMLs por unidade por fase download.
 * - `FOCUS_SYNC_SOFT_BUDGET_MS` (0 = desligado) — corta loops quando o tempo desde o início excede.
 * - `FOCUS_SYNC_LEASE_MINUTES` (default 30) — `focusnfe.nfes_recebidas_sync_lease_until` evita sobreposição cron (manual ignora).
 * - `FOCUS_SYNC_MAX_CHAIN_DEPTH` (default 2) — profundidade de auto re-invoke via `waitUntil(fetch)`.
 *
 * Outros: `FOCUS_NFE_XML_THROTTLE_MS`, `FOCUS_NFE_API_BASE`, secrets Supabase + `FOCUS_NFE_TOKEN` + `FOCUS_NFE_RECEBIDAS_CRON_SECRET`.
 * Logs: `FOCUS_SYNC_VERBOSE_LOGS=true` habilita eventos por página/checkpoint (padrão: só início/fim, erros e resumo enxuto).
 *
 * **Cron:** POST `Authorization: Bearer <secret>`. Opcional body `{ "company_id": "<uuid>" }` para uma unidade (recomendado com pg_net).
 * **Manual:** body pode incluir `max_list_pages`, `max_xml_downloads`, `max_chain_depth`, `list_page_size` (substituem env só nesse POST) além de `versao_inicial`, `phase`, `chain_depth`.
 *
 * **Processor:** após `import_job_files`, dispara `process-import-job-batch` com `invoke` não bloqueante + `EdgeRuntime.waitUntil` quando existir.
 *
 * Implementação: `handle_post.ts` (fluxo POST); utilitários em `constants.ts`, `http.ts`, `focus_xml.ts`, `nfe_cab.ts`, `supabase_ops.ts`, etc.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { corsHeaders } from "./constants.ts";
import { handleFocusSyncPost } from "./handle_post.ts";
import { json } from "./http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
  return handleFocusSyncPost(req);
});

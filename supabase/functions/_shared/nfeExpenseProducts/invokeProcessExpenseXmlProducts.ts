import { NFE_CATALOG_MOTOR_VERSION } from "./types.ts";

/** Por defeito ligado; desligar com `IMPORT_XML_PRODUCTS_AFTER_BATCH=false`. */
export function importXmlProductsAfterBatchEnabled(): boolean {
  const v = String(Deno.env.get("IMPORT_XML_PRODUCTS_AFTER_BATCH") ?? "")
    .trim()
    .toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

const LOG = "[invokeProcessExpenseXmlProducts]";

/** Após a resposta HTTP, o runtime pode encerrar a instância; `waitUntil` mantém o fetch vivo na Edge. */
export function scheduleWaitUntilEdge(p: Promise<unknown>): void {
  try {
    const ER = globalThis.EdgeRuntime;
    if (ER && typeof ER.waitUntil === "function") {
      ER.waitUntil(p);
      return;
    }
  } catch {
    /* ignore */
  }
  void p.catch(() => undefined);
}

/**
 * Chama `process-expense-xml-products` (modo apply). Respeita `IMPORT_XML_PRODUCTS_AFTER_BATCH`.
 */
export function invokeProcessExpenseXmlProducts(params: {
  supabaseUrl: string;
  serviceRole: string;
  anonKey: string;
  companyId: string;
  expenseId: string;
  importJobFileId: string | null | undefined;
  execId: string;
  logPrefix?: string;
}): Promise<void> {
  if (!importXmlProductsAfterBatchEnabled()) return Promise.resolve();
  const {
    supabaseUrl,
    serviceRole,
    anonKey,
    companyId,
    expenseId,
    importJobFileId,
    execId,
    logPrefix = LOG,
  } = params;
  if (!expenseId || !serviceRole || !supabaseUrl) return Promise.resolve();

  const motorUrl =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-expense-xml-products`;
  const body: Record<string, unknown> = {
    company_id: companyId,
    expense_id: expenseId,
    motor_version: NFE_CATALOG_MOTOR_VERSION,
    mode: "apply",
  };
  const fid = String(importJobFileId ?? "").trim();
  if (fid) body.import_job_file_id = fid;

  return fetch(motorUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRole}`,
      apikey: anonKey ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
    .then(async (motorRes) => {
      if (!motorRes.ok) {
        const txt = await motorRes.text().catch(() => "");
        console.warn(
          logPrefix,
          JSON.stringify({
            exec_id: execId,
            fase: "xml_catalog_motor_http",
            expense_id: expenseId,
            status: motorRes.status,
            corpo: txt.slice(0, 500),
          }),
        );
      }
    })
    .catch((e) => {
      console.error(
        logPrefix,
        JSON.stringify({
          exec_id: execId,
          fase: "xml_catalog_motor_invoke_erro",
          expense_id: expenseId,
          erro: String(e),
        }),
      );
    });
}

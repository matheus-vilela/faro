import type { SetupXmlZipImportState, XmlZipFileLogEntry } from "@/types/companySetup";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

export type XmlZipProcessCallbacks = {
  onPhase: (phase: SetupXmlZipImportState["phase"]) => void;
  onLog: (entries: XmlZipFileLogEntry[]) => void;
};

function normalizeXmlZipImportError(raw: unknown): string {
  const msg = typeof raw === "string" ? raw : "";
  const lower = msg.toLowerCase();
  if (
    lower.includes("nenhum xml válido") ||
    lower.includes("nenhum xml valido") ||
    lower.includes("nenhum xml")
  ) {
    return "O ZIP enviado não contém arquivos XML válidos de NF-e. Verifique o arquivo e tente novamente.";
  }
  return msg || "Falha ao importar ZIP de XML.";
}

export async function processXmlZipImport(
  companyId: string,
  file: File,
  callbacks: XmlZipProcessCallbacks,
): Promise<{ ok: boolean; error?: string }> {
  try {
    callbacks.onPhase("uploading");
    const { data: sessData, error: sessErr } = await supabase.auth.getSession();
    const accessToken = sessData.session?.access_token;
    if (sessErr || !accessToken) {
      callbacks.onPhase("error");
      return {
        ok: false,
        error: "Sessão inválida ou expirada. Entre novamente.",
      };
    }

    callbacks.onPhase("parsing");
    callbacks.onPhase("importing");

    const fd = new FormData();
    fd.append("company_id", companyId);
    fd.append("file", file);
    const base = supabaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/functions/v1/enqueue-nfe-import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
      body: fd,
    });

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      callbacks.onPhase("error");
      return { ok: false, error: "Resposta inválida da importação." };
    }

    const o =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    if (!res.ok || o.ok !== true) {
      callbacks.onPhase("error");
      return {
        ok: false,
        error: normalizeXmlZipImportError(
          (typeof o.error === "string" && o.error) ||
            (typeof o.message === "string" && o.message) ||
            "Falha ao importar ZIP de XML.",
        ),
      };
    }
    const batchId = String(o.job_batch_id ?? "").trim();
    if (!batchId) {
      callbacks.onPhase("error");
      return { ok: false, error: "Lote de importação não retornado pelo servidor." };
    }
    callbacks.onLog([{
      name: file.name,
      ok: true,
      status: "success",
      message: "Importação iniciada em segundo plano. Você pode continuar usando o sistema.",
    }]);

    const startedAt = Date.now();
    const timeoutMs = 20_000;
    while (Date.now() - startedAt < timeoutMs) {
      const { data: batch, error: batchErr } = await supabase
        .from("import_job_batches")
        .select("status")
        .eq("id", batchId)
        .maybeSingle();
      if (batchErr) break;
      const status = String((batch as { status?: string } | null)?.status ?? "");
      if (
        status === "COMPLETED" ||
        status === "FAILED" ||
        status === "PARTIAL_SUCCESS" ||
        status === "COMPLETED_WITH_PENDING_REVIEW"
      ) {
        const { data: files } = await supabase
          .from("import_job_files")
          .select("file_name, status, last_error")
          .eq("batch_id", batchId)
          .order("created_at", { ascending: true });
        const out: XmlZipFileLogEntry[] = (files ?? []).map((f) => {
          const row = f as { file_name: string; status: string; last_error?: string | null };
          const ok = row.status === "COMPLETED" || row.status === "COMPLETED_WITH_PENDING_REVIEW";
          const mappedStatus: XmlZipFileLogEntry["status"] =
            row.status === "COMPLETED"
              ? "success"
              : row.status === "COMPLETED_WITH_PENDING_REVIEW"
                ? "needs_review"
                : row.status === "FAILED"
                  ? "validation_error"
                  : "duplicate";
          return {
            name: row.file_name,
            ok,
            status: mappedStatus,
            message: ok ? (row.status === "COMPLETED_WITH_PENDING_REVIEW" ? "Concluído com pendências de revisão." : "Concluído.") : (row.last_error ?? "Falha."),
          };
        });
        callbacks.onLog(out);
        callbacks.onPhase("done");
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    callbacks.onPhase("done");
    callbacks.onLog([{
      name: file.name,
      ok: true,
      status: "needs_review",
      message: "Importação segue em segundo plano. Acompanhe em Importações.",
    }]);
    return { ok: true };
  } catch (e) {
    callbacks.onPhase("error");
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha na importação.",
    };
  }
}

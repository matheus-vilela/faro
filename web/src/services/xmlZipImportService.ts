import type { SetupXmlZipImportState, XmlZipFileLogEntry } from "@/types/companySetup";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

export type XmlZipProcessCallbacks = {
  onPhase: (phase: SetupXmlZipImportState["phase"]) => void;
  onLog: (entries: XmlZipFileLogEntry[]) => void;
};

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
    const res = await fetch(`${base}/functions/v1/import-nfe-zip`, {
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
        error:
          (typeof o.error === "string" && o.error) ||
          (typeof o.message === "string" && o.message) ||
          "Falha ao importar ZIP de XML.",
      };
    }
    const files = Array.isArray(o.files) ? o.files : [];
    const out: XmlZipFileLogEntry[] = files.map((f) => {
      const row = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
      return {
        name: typeof row.name === "string" ? row.name : file.name,
        ok: row.ok === true,
        status:
          typeof row.status === "string"
            ? (row.status as XmlZipFileLogEntry["status"])
            : undefined,
        message: typeof row.message === "string" ? row.message : undefined,
      };
    });
    callbacks.onLog(out);
    callbacks.onPhase("done");
    return { ok: true };
  } catch (e) {
    callbacks.onPhase("error");
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha na importação.",
    };
  }
}

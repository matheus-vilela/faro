import type { SetupXmlZipImportState, XmlZipFileLogEntry } from "@/types/companySetup";

export type XmlZipProcessCallbacks = {
  onPhase: (phase: SetupXmlZipImportState["phase"]) => void;
  onLog: (entries: XmlZipFileLogEntry[]) => void;
};

/**
 * Processamento placeholder: simula parsing e importação.
 * Contrato estável para trocar por Edge Function / fila depois.
 */
export async function processXmlZipImport(
  _companyId: string,
  _file: File,
  callbacks: XmlZipProcessCallbacks,
): Promise<{ ok: boolean; error?: string }> {
  try {
    callbacks.onPhase("uploading");
    await delay(400);
    callbacks.onPhase("parsing");
    await delay(700);
    const fakeLog: XmlZipFileLogEntry[] = [
      { name: "exemplo-nfe.xml", ok: true, message: "Registrado (simulação)" },
    ];
    callbacks.onLog(fakeLog);
    callbacks.onPhase("preview");
    await delay(300);
    callbacks.onPhase("importing");
    await delay(800);
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

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

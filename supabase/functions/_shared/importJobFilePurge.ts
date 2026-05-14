/**
 * Limpeza pós-sucesso de importação XML: remove linhas de `import_job_items` e zera
 * `import_job_files.xml_content_base64` (coluna NOT NULL — usa string vazia).
 *
 * Desliga com `IMPORT_BATCH_PURGE_ON_COMPLETE=false`.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function readEdgeEnv(name: string): string | undefined {
  try {
    const d = (globalThis as { Deno?: { env: { get: (n: string) => string | undefined } } }).Deno;
    return d?.env.get(name);
  } catch {
    return undefined;
  }
}

export function importPurgeOnCompleteEnabled(): boolean {
  const v = String(readEdgeEnv("IMPORT_BATCH_PURGE_ON_COMPLETE") ?? "true")
    .trim()
    .toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/** Campos extra a fundir no `update` de `import_job_files` quando o purge está ativo. */
export function importJobFileXmlClearPatch():
  | { xml_content_base64: string }
  | Record<string, never> {
  return importPurgeOnCompleteEnabled() ? { xml_content_base64: "" } : {};
}

/**
 * Apaga todos os `import_job_items` deste ficheiro (não remove a linha do ficheiro).
 * Chamar antes do `update` final do `import_job_files` quando o estado for concluído com sucesso.
 */
export async function deleteImportJobItemsIfPurging(
  client: SupabaseClient,
  fileId: string,
): Promise<{ error?: string }> {
  if (!importPurgeOnCompleteEnabled()) return {};
  const { error } = await client.from("import_job_items").delete().eq("file_id", fileId);
  return { error: error?.message };
}

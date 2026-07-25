/**
 * Pré-visualização dry-run da lógica de interpretação de XML em staging
 * (fornecedor, produtos, conversões, despesa, boletos) sem gravar no banco.
 */
import type { StagingNfeInterpretLog } from "./stagingNfeInterpretLog.ts";
import { interpretStagingNfeXmlForLog } from "./stagingNfeInterpretLog.ts";
import {
  buildStagingInterpretPreviewFromLog,
  type StagingInterpretPreviewResult,
} from "./stagingNfeInterpretPostProcess.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type { StagingInterpretPreviewResult };

export type StagingInterpretPreviewLine =
  StagingInterpretPreviewResult["products_by_line"][number];

export async function buildStagingInterpretPreview(
  admin: SupabaseAdmin,
  companyId: string,
  xmlText: string,
): Promise<
  | { ok: true; staging_interpret: StagingInterpretPreviewResult }
  | { ok: false; error: string }
> {
  const trimmed = xmlText.trim();
  if (!trimmed.startsWith("<")) {
    return { ok: false, error: "Conteúdo não parece XML de NF-e." };
  }

  const interpret = interpretStagingNfeXmlForLog("", trimmed);
  if (!interpret.parse_ok) {
    return {
      ok: false,
      error:
        interpret.parse_erro === "parseNfeXmlToExtracted_null"
          ? "Não foi possível ler NF-e neste XML."
          : "XML inválido ou sem corpo de NF-e.",
    };
  }

  const staging_interpret = await buildStagingInterpretPreviewFromLog(
    admin,
    companyId,
    interpret,
  );

  return { ok: true, staging_interpret };
}

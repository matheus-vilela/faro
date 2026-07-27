/**
 * Pré-visualização de NF-e: parse do XML, valor unitário efetivo e dry-run da
 * interpretação staging (dry-run).
 */
import { buildNfeUnitPricePreviewFromXml } from "./nfeUnitPricePreview.ts";
import type { NfeUnitPricePreviewResult } from "./nfeUnitPricePreview.ts";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import type { StagingInterpretPreviewResult } from "./stagingNfeInterpretPreview.ts";
import { buildStagingInterpretPreviewFromLog } from "./stagingNfeInterpretPostProcess.ts";
import {
  interpretStagingNfeXmlForLog,
  type StagingNfeInterpretLog,
} from "./stagingNfeInterpretLog.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type DevNfeXmlPreviewDetLine = {
  n_item: string | null;
  c_prod: string | null;
  x_prod: string | null;
  prod: Record<string, unknown>;
};

export type DevNfeXmlPreviewOk = {
  ok: true;
  file_name: string;
  xml_data: StagingNfeInterpretLog;
  unit_price_preview: NfeUnitPricePreviewResult | null;
  det_lines: DevNfeXmlPreviewDetLine[];
  /** Dry-run: fornecedor, produtos, conversões, despesa e boletos (interpret staging). */
  staging_interpret: StagingInterpretPreviewResult | null;
  staging_interpret_error?: string | null;
};

export type DevNfeXmlPreviewResult =
  | DevNfeXmlPreviewOk
  | { ok: false; error: string };

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

export async function buildDevNfeXmlPreview(
  xmlText: string,
  fileName: string,
  options?: {
    admin?: SupabaseAdmin;
    companyId?: string;
  },
): Promise<DevNfeXmlPreviewResult> {
  const trimmed = xmlText.trim();
  if (!trimmed.startsWith("<")) {
    return { ok: false, error: "Conteúdo não parece XML de NF-e." };
  }

  const xml_data = interpretStagingNfeXmlForLog("", trimmed);
  if (!xml_data.parse_ok) {
    return {
      ok: false,
      error:
        xml_data.parse_erro === "parseNfeXmlToExtracted_null"
          ? "Não foi possível ler NF-e neste XML. Confirme nfeProc/NFe com itens em <det>."
          : "XML inválido ou sem corpo de NF-e.",
    };
  }

  const catalog = parseNfeXmlForUnifiedCatalog(trimmed);
  const det_lines: DevNfeXmlPreviewDetLine[] = (catalog?.lines ?? []).map(
    (line) => ({
      n_item: line.nItem,
      c_prod: str(line.prod.cProd ?? line.prod.cprod),
      x_prod: str(line.prod.xProd),
      prod: line.prod,
    }),
  );

  const unit_price_preview = buildNfeUnitPricePreviewFromXml(trimmed);

  let staging_interpret: StagingInterpretPreviewResult | null = null;
  let staging_interpret_error: string | null = null;
  const companyId = String(options?.companyId ?? "").trim();
  if (options?.admin && companyId) {
    try {
      staging_interpret = await buildStagingInterpretPreviewFromLog(
        options.admin,
        companyId,
        xml_data,
      );
    } catch (e) {
      staging_interpret_error =
        e instanceof Error ? e.message : "Erro ao simular interpretação staging.";
    }
  }

  return {
    ok: true,
    file_name: fileName || "nota.xml",
    xml_data,
    unit_price_preview,
    det_lines,
    staging_interpret,
    staging_interpret_error,
  };
}

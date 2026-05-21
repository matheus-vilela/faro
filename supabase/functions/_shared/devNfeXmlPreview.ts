/**
 * Pré-visualização leve de NF-e: só parse do XML + breakdown de preço unitário.
 */
import { buildNfeUnitPricePreviewFromXml } from "./nfeUnitPricePreview.ts";
import type { NfeUnitPricePreviewResult } from "./nfeUnitPricePreview.ts";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import {
  interpretStagingNfeXmlForLog,
  type StagingNfeInterpretLog,
} from "./stagingNfeInterpretLog.ts";

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
};

export type DevNfeXmlPreviewResult =
  | DevNfeXmlPreviewOk
  | { ok: false; error: string };

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

export function buildDevNfeXmlPreview(
  xmlText: string,
  fileName: string,
): DevNfeXmlPreviewResult {
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

  return {
    ok: true,
    file_name: fileName || "nota.xml",
    xml_data,
    unit_price_preview,
    det_lines,
  };
}

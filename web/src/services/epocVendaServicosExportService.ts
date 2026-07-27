import { fetchSupabaseEdgeFunction } from "@/lib/supabase";
import {
  downloadTextAsFile,
  yesterdayIsoSaoPaulo,
} from "@/services/epocFaturamentoExportService";

export { downloadTextAsFile, yesterdayIsoSaoPaulo };

export type EpocVendaServicosExportDayDetail = {
  data_consulta: string;
  itens: number;
  resumo: number;
  message: string | null;
};

export type EpocVendaServicosExportOk = {
  ok: true;
  file_name: string;
  csv: string;
  download_url: string | null;
  storage_path: string | null;
  dias_consultados: string[];
  total_rows: number;
  total_itens: number;
  max_cols: number;
  dias_com_dados: number;
  dias_detalhe: EpocVendaServicosExportDayDetail[];
};

export type EpocVendaServicosExportFail = {
  ok: false;
  error: string;
  dias_consultados?: string[];
  dias_detalhe?: EpocVendaServicosExportDayDetail[];
};

export type EpocVendaServicosExportResult =
  | EpocVendaServicosExportOk
  | EpocVendaServicosExportFail;

function formatDateBrFromIsoLocal(isoYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoYmd.trim());
  if (!m) return isoYmd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export async function exportEpocVendaServicosCsv(params: {
  companyId: string;
  dataDeIso: string;
  dataAteIso: string;
}): Promise<EpocVendaServicosExportResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-export-venda-servicos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId,
      data_de: formatDateBrFromIsoLocal(params.dataDeIso),
      data_ate: formatDateBrFromIsoLocal(params.dataAteIso),
    }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      error: `Resposta inválida (HTTP ${res.status}).`,
    };
  }

  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === true &&
    "csv" in payload &&
    typeof (payload as { csv: unknown }).csv === "string"
  ) {
    return payload as EpocVendaServicosExportOk;
  }

  const err =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Falha ao exportar (HTTP ${res.status}).`;

  return {
    ok: false,
    error: err,
    ...(payload && typeof payload === "object"
      ? (payload as Partial<EpocVendaServicosExportFail>)
      : {}),
  };
}

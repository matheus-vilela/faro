import { fetchSupabaseEdgeFunction } from "@/lib/supabase";

export type EpocFaturamentoExportDayDetail = {
  data_consulta: string;
  secoes: number;
  linhas: number;
  message: string | null;
};

export type EpocFaturamentoExportOk = {
  ok: true;
  file_name: string;
  csv: string;
  download_url: string | null;
  storage_path: string | null;
  dias_consultados: string[];
  total_rows: number;
  max_cols: number;
  dias_com_dados: number;
  dias_detalhe: EpocFaturamentoExportDayDetail[];
};

export type EpocFaturamentoExportFail = {
  ok: false;
  error: string;
  dias_consultados?: string[];
  dias_detalhe?: EpocFaturamentoExportDayDetail[];
};

export type EpocFaturamentoExportResult =
  | EpocFaturamentoExportOk
  | EpocFaturamentoExportFail;

function formatDateBrFromIsoLocal(isoYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoYmd.trim());
  if (!m) return isoYmd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Ontem civil no fuso America/Sao_Paulo, como `yyyy-MM-dd` para `<input type="date">`. */
export function yesterdayIsoSaoPaulo(): string {
  const ymdInTz = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const today = ymdInTz(new Date());
  let probe = new Date(Date.now() - 12 * 60 * 60 * 1000);
  for (let i = 0; i < 48; i++) {
    const ymd = ymdInTz(probe);
    if (ymd !== today) return ymd;
    probe = new Date(probe.getTime() - 60 * 60 * 1000);
  }
  const [y, m, d] = today.split("-").map((x) => parseInt(x, 10));
  const fb = new Date(Date.UTC(y, m - 1, d - 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fb.getUTCFullYear()}-${pad(fb.getUTCMonth() + 1)}-${pad(fb.getUTCDate())}`;
}

export async function exportEpocFaturamentoCsv(params: {
  companyId: string;
  /** `yyyy-MM-dd` do input date */
  dataDeIso: string;
  dataAteIso: string;
}): Promise<EpocFaturamentoExportResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-export-faturamento", {
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
    return payload as EpocFaturamentoExportOk;
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
      ? (payload as Partial<EpocFaturamentoExportFail>)
      : {}),
  };
}

export function downloadTextAsFile(
  content: string,
  fileName: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

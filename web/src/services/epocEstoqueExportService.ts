import { fetchSupabaseEdgeFunction } from "@/lib/supabase";
import {
  downloadTextAsFile,
  yesterdayIsoSaoPaulo,
} from "@/services/epocFaturamentoExportService";

export { downloadTextAsFile, yesterdayIsoSaoPaulo };

export type EpocEstoqueSaidaItem = {
  sku: string;
  nome: string;
  categorias: string[];
  categoria_path: string;
  acao: string;
  obs: string;
  qtde: number | null;
  qtde_unidade: string;
  qtde_raw: string;
  qtde_volume_saida: number | null;
  custo_total: number | null;
};

export type EpocEstoqueExportOk = {
  ok: true;
  data: string;
  file_name: string;
  csv: string;
  items: EpocEstoqueSaidaItem[];
  total_itens: number;
  total_custo: number;
  raw_rows: number;
  group_rows: number;
  other_action_count: number;
};

export type EpocEstoqueExportFail = {
  ok: false;
  error: string;
  data?: string;
  items?: EpocEstoqueSaidaItem[];
};

export type EpocEstoqueExportResult =
  | EpocEstoqueExportOk
  | EpocEstoqueExportFail;

function formatDateBrFromIsoLocal(isoYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoYmd.trim());
  if (!m) return isoYmd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function isEstoqueItem(value: unknown): value is EpocEstoqueSaidaItem {
  if (!value || typeof value !== "object") return false;
  const it = value as Record<string, unknown>;
  return typeof it.sku === "string" && typeof it.nome === "string";
}

export async function exportEpocEstoqueDia(params: {
  companyId: string;
  dataIso: string;
}): Promise<EpocEstoqueExportResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-export-estoque", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId,
      data: formatDateBrFromIsoLocal(params.dataIso),
    }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: `Resposta inválida (HTTP ${res.status}).` };
  }

  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === true &&
    "items" in payload &&
    Array.isArray((payload as { items: unknown }).items) &&
    ((payload as { items: unknown[] }).items.every(isEstoqueItem))
  ) {
    return payload as EpocEstoqueExportOk;
  }

  const err =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Falha ao consultar estoque (HTTP ${res.status}).`;

  return { ok: false, error: err };
}

import { FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY } from "./constants.ts";
import type { NfeCab, Phase } from "./types.ts";

export function nfeCompletaTrue(cab: NfeCab): boolean {
  const raw = (cab as Record<string, unknown>).nfe_completa;
  // Alguns payloads da Focus omitem este campo no endpoint de listagem.
  // Nestes casos, seguimos com a tentativa de download do XML por chave.
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  if (raw === true) return true;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "true") return true;
  if (raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "1" || s === "sim" || s === "yes") return true;
  }
  return false;
}

export function nfeRecebidaImportavel(cab: NfeCab): boolean {
  const situacao = String(cab.situacao ?? "").trim().toLowerCase();
  const autorizada = situacao === "autorizada" || situacao === "autorizado";
  return autorizada && nfeCompletaTrue(cab);
}

/**
 * Modo teste manual (sem `test_single_key`): a API Focus pode devolver até ~100 itens por página
 * (ou o tamanho pedido em `limite`); limitamos a N cabeçalhos importáveis para não disparar dedup/fila em lote cheio.
 */
export function limitCabListForManualTest(
  cabList: NfeCab[],
  opts: {
    isManualSingle: boolean;
    manualTestMode: boolean;
    manualTestSingleKey: string | null;
    maxImportable: number;
  },
): NfeCab[] {
  const { isManualSingle, manualTestMode, manualTestSingleKey, maxImportable } = opts;
  if (!isManualSingle || !manualTestMode || manualTestSingleKey || maxImportable <= 0) {
    return cabList;
  }
  const out: NfeCab[] = [];
  for (const cab of cabList) {
    const chave = String(cab.chave_nfe ?? "").replace(/\D/g, "");
    if (chave.length !== 44) continue;
    if (!nfeRecebidaImportavel(cab)) continue;
    out.push(cab);
    if (out.length >= maxImportable) break;
  }
  return out;
}

export function focusIdEmpresa(raw: Record<string, unknown> | undefined): unknown {
  const v = raw?.id_empresa;
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return null;
}

export function parsePhase(raw: unknown): Phase {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "list" || s === "download" || s === "auto") return s;
  return "auto";
}

export function budgetExceeded(t0: number, softBudgetMs: number): boolean {
  if (softBudgetMs <= 0) return false;
  return performance.now() - t0 > softBudgetMs;
}

/** Página “cheia” — pode existir continuação na próxima versão. */
export function listFocusPageIsFull(len: number, requestedPageSize: number): boolean {
  if (len >= FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY) return true;
  return len === requestedPageSize;
}

export function parseCabTotal(cab: NfeCab): number | null {
  const raw = cab.valor_total ?? cab.valor ?? cab.total ?? null;
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

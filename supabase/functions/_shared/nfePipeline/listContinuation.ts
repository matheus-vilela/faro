/**
 * Cursor da listagem Focus /v2/nfes_recebidas (`versao` + x-max-version).
 * A API devolve ~50 itens por página; o header x-max-version por vezes vem vazio.
 */

/** Tamanho típico da página Focus; página cheia ⇒ pode haver continuação. */
export const FOCUS_NFE_LIST_PAGE_HINT = 50;

export function maxItemFocusVersion(
  items: Array<Record<string, unknown>>,
): number | null {
  let max: number | null = null;
  for (const item of items) {
    const n = Number(item["versao"]);
    if (!Number.isFinite(n)) continue;
    const v = Math.trunc(n);
    if (max == null || v > max) max = v;
  }
  return max;
}

export function resolveFetchPageContinuation(input: {
  versao: number;
  itemCount: number;
  xTotalCount: number | null;
  xMaxVersion: number | null;
  maxItemVersion: number | null;
}): { listDone: boolean; nextVersao: number | null } {
  const versao = Math.max(0, Math.floor(Number(input.versao) || 0));
  const itemCount = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const header =
    input.xMaxVersion != null && Number.isFinite(input.xMaxVersion)
      ? Math.trunc(input.xMaxVersion)
      : null;
  const fromItems =
    input.maxItemVersion != null && Number.isFinite(input.maxItemVersion)
      ? Math.trunc(input.maxItemVersion)
      : null;
  const cursor =
    header != null && fromItems != null
      ? Math.max(header, fromItems)
      : (header ?? fromItems);

  if (input.xTotalCount === 0) {
    return { listDone: true, nextVersao: null };
  }

  if (itemCount === 0) {
    if (cursor != null && cursor > versao) {
      return { listDone: false, nextVersao: cursor };
    }
    return { listDone: true, nextVersao: null };
  }

  if (cursor != null && cursor > versao) {
    return { listDone: false, nextVersao: cursor };
  }

  // Página cheia sem avanço de cursor: não esgotar (senão o onboarding
  // parte em vários ciclos de ~50 NF-e). Sem nextVersao o close_cycle
  // mantém a listagem aberta em vez de marcar completed.
  if (itemCount >= FOCUS_NFE_LIST_PAGE_HINT) {
    return { listDone: false, nextVersao: null };
  }

  return { listDone: true, nextVersao: null };
}

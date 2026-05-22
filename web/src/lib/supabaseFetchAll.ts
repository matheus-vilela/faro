/** Tamanho máximo por página no PostgREST (Supabase). */
export const SUPABASE_MAX_PAGE_SIZE = 1000;

type RangeResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<RangeResult<T>>;
};

/** Busca todas as linhas de uma query paginada (evita corte em ~1000 registros). */
export async function fetchAllInRange<T>(
  query: RangeQuery<T>,
  pageSize = SUPABASE_MAX_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      throw error;
    }
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

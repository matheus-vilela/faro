/** Slug curto alfanumérico (links públicos WhatsApp / PWA). */
export function randomShortSlug(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]!).join("");
}

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    insert: (
      row: Record<string, unknown>,
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

/**
 * Cria ou reutiliza slug em tabela de short links (service role).
 * `fkColumn` = run_id | session_id | draft_id etc.
 */
export async function ensureShortSlug(params: {
  supabase: SupabaseLike;
  table: string;
  companyId: string;
  fkColumn: string;
  fkValue: string;
  token: string;
  logPrefix?: string;
  maxAttempts?: number;
}): Promise<string | null> {
  const {
    supabase,
    table,
    companyId,
    fkColumn,
    fkValue,
    token,
    logPrefix = "[short-slug]",
    maxAttempts = 15,
  } = params;

  const { data: existing } = await supabase
    .from(table)
    .select("slug")
    .eq(fkColumn, fkValue)
    .maybeSingle();

  const row = existing as { slug?: string } | null;
  if (row?.slug && typeof row.slug === "string") {
    return row.slug;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = randomShortSlug(8);
    const { error } = await supabase.from(table).insert({
      company_id: companyId,
      slug,
      [fkColumn]: fkValue,
      token,
    });
    if (!error) return slug;
    if (error.code !== "23505") {
      console.error(`${logPrefix} ensureShortSlug:`, error.message);
      return null;
    }
  }
  return null;
}

/**
 * Reaplica match de produtos no servidor (service role) ao abrir o link /w/:token.
 * O cliente anon não enxerga catálogo/config de importação (RLS).
 */
export async function refreshWhatsappDraftProductMatches(
  token: string,
): Promise<unknown | null> {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/functions/v1/refresh-whatsapp-draft-matches`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
        body: JSON.stringify({ token }),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      ok?: boolean;
      extracted_json?: unknown;
    };
    if (!j?.ok || j.extracted_json == null) return null;
    return j.extracted_json;
  } catch {
    return null;
  }
}

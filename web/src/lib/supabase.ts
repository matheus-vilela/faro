import { createClient, FunctionsFetchError } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Best-effort detail for `supabase.functions.invoke` failures (network vs HTTP). */
export function formatSupabaseFunctionError(error: unknown): string {
  if (error instanceof FunctionsFetchError) {
    const ctx = error.context
    const inner =
      ctx instanceof Error
        ? ctx.message
        : ctx != null && typeof ctx === 'object' && 'message' in ctx
          ? String((ctx as { message: unknown }).message)
          : ctx != null
            ? String(ctx)
            : ''
    return [error.message, inner].filter(Boolean).join(" — ")
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * POST to an Edge Function with the same auth headers as the JS client.
 * Prefer this over `functions.invoke` for FormData so the browser sets multipart boundaries.
 */
export async function fetchSupabaseEdgeFunction(
  functionName: string,
  init: RequestInit & { body?: BodyInit },
  accessToken?: string | null,
): Promise<Response> {
  const base = supabaseUrl.replace(/\/+$/, '')
  const url = `${base}/functions/v1/${functionName.replace(/^\//, '')}`
  let token = accessToken
  if (!token) {
    const { data: sessionData } = await supabase.auth.getSession()
    token = sessionData.session?.access_token ?? supabaseAnonKey
  }
  const headers = new Headers(init.headers)
  if (!headers.has('apikey')) headers.set('apikey', supabaseAnonKey)
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}

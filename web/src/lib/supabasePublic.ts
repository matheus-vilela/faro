import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Cliente anon sem sessão persistida — usado em rotas públicas (ex.: /w/:token).
 * Evita erros de refresh token quando o usuário não está logado ou a sessão está inválida;
 * o acesso é validado só pelo token do link nas RPCs (SECURITY DEFINER + GRANT anon).
 */
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

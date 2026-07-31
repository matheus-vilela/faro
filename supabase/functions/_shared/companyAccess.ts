/**
 * Acesso a unidade: membership em `user_companies` **ou** `profiles.is_admin`.
 * Usar cliente com service role (bypass RLS) para a verificação.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export async function isPlatformAdminUser(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[companyAccess] profiles.is_admin:", error.message);
    return false;
  }
  return data?.is_admin === true;
}

/** True se o utilizador é membro da unidade ou admin global Faro. */
export async function userHasCompanyAccess(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<boolean> {
  if (await isPlatformAdminUser(admin, userId)) return true;
  const { data, error } = await admin
    .from("user_companies")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[companyAccess] user_companies:", error.message);
    return false;
  }
  return data != null;
}

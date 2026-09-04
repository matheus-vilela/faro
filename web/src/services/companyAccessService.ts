import { platformAccessInviteAction } from "@/lib/platformAccessInvite";
import {
  DEFAULT_MEMBER_PERMISSIONS,
  parsePermissionKeys,
  type PermissionKey,
} from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import type {
  CompanyPermissionProfile,
  CompanyPlatformAccess,
} from "@/types/companyPermissions";

function mapProfile(row: Record<string, unknown>): CompanyPermissionProfile {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    name: String(row.name ?? ""),
    is_system: row.is_system === true,
    permissions: parsePermissionKeys(row.permissions),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function mapAccess(row: Record<string, unknown>): CompanyPlatformAccess {
  const embed = row.company_permission_profiles;
  const profile =
    embed && typeof embed === "object" && !Array.isArray(embed)
      ? {
          id: String((embed as Record<string, unknown>).id),
          name: String((embed as Record<string, unknown>).name ?? ""),
          permissions: parsePermissionKeys(
            (embed as Record<string, unknown>).permissions,
          ),
        }
      : null;

  return {
    id: String(row.id),
    company_id: String(row.company_id),
    email: String(row.email ?? ""),
    permission_profile_id: String(row.permission_profile_id),
    invited_by: row.invited_by != null ? String(row.invited_by) : null,
    status: row.status as CompanyPlatformAccess["status"],
    user_id: row.user_id != null ? String(row.user_id) : null,
    created_at: String(row.created_at ?? ""),
    accepted_at:
      row.accepted_at != null ? String(row.accepted_at) : null,
    company_permission_profiles: profile,
  };
}

export async function acceptMyPendingPlatformAccess(): Promise<void> {
  await supabase.rpc("accept_my_pending_platform_access");
}

export async function fetchCompanyPermissionProfiles(
  companyId: string,
): Promise<{ profiles: CompanyPermissionProfile[]; error?: string }> {
  const { data, error } = await supabase
    .from("company_permission_profiles")
    .select("*")
    .eq("company_id", companyId)
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });

  if (error) return { profiles: [], error: error.message };
  return { profiles: (data ?? []).map((r) => mapProfile(r as Record<string, unknown>)) };
}

export async function fetchCompanyPlatformAccess(
  companyId: string,
): Promise<{ access: CompanyPlatformAccess[]; error?: string }> {
  const { data, error } = await supabase
    .from("company_platform_access")
    .select("*, company_permission_profiles(id, name, permissions)")
    .eq("company_id", companyId)
    .neq("status", "revoked")
    .order("created_at", { ascending: false });

  if (error) return { access: [], error: error.message };
  return { access: (data ?? []).map((r) => mapAccess(r as Record<string, unknown>)) };
}

export async function createPermissionProfile(input: {
  companyId: string;
  name: string;
  permissions: PermissionKey[];
}): Promise<{ profile?: CompanyPermissionProfile; error?: string }> {
  const { data, error } = await supabase
    .from("company_permission_profiles")
    .insert({
      company_id: input.companyId,
      name: input.name.trim(),
      is_system: false,
      permissions: input.permissions,
    })
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "Erro ao criar perfil." };
  return { profile: mapProfile(data as Record<string, unknown>) };
}

export async function updatePermissionProfile(input: {
  profileId: string;
  name: string;
  permissions: PermissionKey[];
}): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("company_permission_profiles")
    .update({
      name: input.name.trim(),
      permissions: input.permissions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.profileId);

  return { error: error?.message };
}

export async function deletePermissionProfile(
  profileId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("company_permission_profiles")
    .delete()
    .eq("id", profileId)
    .eq("is_system", false);

  return { error: error?.message };
}

export async function addPlatformAccessByEmail(input: {
  companyId: string;
  email: string;
  permissionProfileId: string;
  invitedBy: string;
}): Promise<{ error?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { error: "E-mail inválido." };

  const { data: existingRows, error: findErr } = await supabase
    .from("company_platform_access")
    .select("id, status, email")
    .eq("company_id", input.companyId);

  if (findErr) return { error: findErr.message };

  const existing =
    existingRows?.find(
      (row) => String(row.email ?? "").trim().toLowerCase() === email,
    ) ?? null;

  const action = platformAccessInviteAction(existing);
  if (action === "exists") {
    return { error: "Este e-mail já está cadastrado nesta empresa." };
  }

  if (action === "reinvite" && existing) {
    const { error: delErr } = await supabase
      .from("company_platform_access")
      .delete()
      .eq("id", existing.id);
    if (delErr) return { error: delErr.message };
  }

  const { error } = await supabase.from("company_platform_access").insert({
    company_id: input.companyId,
    email,
    permission_profile_id: input.permissionProfileId,
    invited_by: input.invitedBy,
    status: "pending",
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Este e-mail já está cadastrado nesta empresa." };
    }
    return { error: error.message };
  }

  return {};
}

export async function revokePlatformAccess(
  accessId: string,
): Promise<{ error?: string }> {
  const { data: row, error: readErr } = await supabase
    .from("company_platform_access")
    .select("id, company_id, user_id, status")
    .eq("id", accessId)
    .maybeSingle();

  if (readErr || !row) {
    return { error: readErr?.message ?? "Acesso não encontrado." };
  }

  const { error: updErr } = await supabase
    .from("company_platform_access")
    .update({ status: "revoked" })
    .eq("id", accessId);

  if (updErr) return { error: updErr.message };

  if (row.user_id && row.status === "active") {
    await supabase
      .from("user_companies")
      .delete()
      .eq("user_id", row.user_id)
      .eq("company_id", row.company_id)
      .eq("role", "member");
  }

  return {};
}

export type CompanyPlatformOwner = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

export async function fetchCompanyPlatformOwner(
  companyId: string,
): Promise<{ owner: CompanyPlatformOwner | null; error?: string }> {
  const { data: uc, error: ucErr } = await supabase
    .from("user_companies")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", "owner")
    .maybeSingle();

  if (ucErr) return { owner: null, error: ucErr.message };
  if (!uc?.user_id) return { owner: null };

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", uc.user_id)
    .maybeSingle();

  if (profileErr) return { owner: null, error: profileErr.message };

  return {
    owner: {
      user_id: uc.user_id,
      full_name: profile?.full_name?.trim() ?? null,
      email: null,
    },
  };
}

export async function updateCollaboratorPermissionProfile(input: {
  companyId: string;
  accessId: string;
  permissionProfileId: string;
  userId?: string | null;
}): Promise<{ error?: string }> {
  const { error: accessErr } = await supabase
    .from("company_platform_access")
    .update({
      permission_profile_id: input.permissionProfileId,
    })
    .eq("id", input.accessId)
    .eq("company_id", input.companyId);

  if (accessErr) return { error: accessErr.message };

  if (input.userId) {
    const { error: memberErr } = await supabase
      .from("user_companies")
      .update({
        permission_profile_id: input.permissionProfileId,
      })
      .eq("user_id", input.userId)
      .eq("company_id", input.companyId)
      .eq("role", "member");

    if (memberErr) return { error: memberErr.message };
  }

  return {};
}

export async function getDefaultMemberProfileId(
  companyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("company_permission_profiles")
    .select("id")
    .eq("company_id", companyId)
    .eq("name", "Membro")
    .eq("is_system", true)
    .maybeSingle();

  return data?.id ?? null;
}

export { DEFAULT_MEMBER_PERMISSIONS };

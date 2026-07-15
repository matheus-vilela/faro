import type { PermissionKey } from "@/lib/permissions";

export type CompanyPermissionProfile = {
  id: string;
  company_id: string;
  name: string;
  is_system: boolean;
  permissions: PermissionKey[];
  created_at: string;
  updated_at: string;
};

export type CompanyPlatformAccess = {
  id: string;
  company_id: string;
  email: string;
  permission_profile_id: string;
  invited_by: string | null;
  status: "pending" | "active" | "revoked";
  user_id: string | null;
  created_at: string;
  accepted_at: string | null;
  company_permission_profiles?: Pick<
    CompanyPermissionProfile,
    "id" | "name" | "permissions"
  > | null;
};

import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  hasAnyPermission,
  hasPermission,
  permissionKeyForPath,
  type PermissionKey,
} from "@/lib/permissions";
import { isOwnerRole } from "@/lib/roles";
import { Navigate, useLocation } from "react-router-dom";

export function PermissionRouteGuard({
  permission,
  permissions,
  children,
  ownerOnly = false,
}: {
  permission?: PermissionKey;
  /** Quando informado, exige ao menos uma das permissões listadas. */
  permissions?: PermissionKey[];
  ownerOnly?: boolean;
  children: React.ReactNode;
}) {
  const { currentRole, currentPermissions, loading } = useCompany();
  const { isAdmin } = useAuth();
  const location = useLocation();

  if (loading) return null;

  // Admin global: qualquer rota/ação da plataforma.
  if (isAdmin) {
    return <>{children}</>;
  }

  if (ownerOnly) {
    if (!isOwnerRole(currentRole)) {
      return <Navigate to="/app" replace />;
    }
    return <>{children}</>;
  }

  if (isOwnerRole(currentRole)) {
    return <>{children}</>;
  }

  if (permissions?.length) {
    if (!hasAnyPermission(currentPermissions, permissions)) {
      return <Navigate to="/app" replace />;
    }
    return <>{children}</>;
  }

  const key = permission ?? permissionKeyForPath(location.pathname);
  if (!key || !hasPermission(currentPermissions, key)) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

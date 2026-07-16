import { useCompany } from "@/contexts/CompanyContext";
import {
  hasPermission,
  permissionKeyForPath,
  type PermissionKey,
} from "@/lib/permissions";
import { isOwnerRole } from "@/lib/roles";
import { Navigate, useLocation } from "react-router-dom";

export function PermissionRouteGuard({
  permission,
  children,
  ownerOnly = false,
}: {
  permission?: PermissionKey;
  ownerOnly?: boolean;
  children: React.ReactNode;
}) {
  const { currentRole, currentPermissions, loading } = useCompany();
  const location = useLocation();

  if (loading) return null;

  if (ownerOnly) {
    if (!isOwnerRole(currentRole)) {
      return <Navigate to="/app" replace />;
    }
    return <>{children}</>;
  }

  if (isOwnerRole(currentRole)) {
    return <>{children}</>;
  }

  const key = permission ?? permissionKeyForPath(location.pathname);
  if (!key || !hasPermission(currentPermissions, key)) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

import {
  acceptMyPendingPlatformAccess,
} from "@/services/companyAccessService";
import {
  hasPermission,
  parsePermissionKeys,
  type PermissionKey,
} from "@/lib/permissions";
import type { UserCompanyRole } from "@/lib/roles";
import { isOwnerRole } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyGroup } from "@/types/companyGroup";
import type { CompanyNotificationEntry } from "@/types/companyNotification";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";

interface OnboardingFiscalMetrics {
  sync: boolean;
  max_nfes_sync: number;
  nfes_sync: number;
  nfes_ignored: number;
  completed?: boolean;
  capture_completed?: boolean;
  list_exhausted?: boolean;
  sefaz_unavailable?: boolean;
  sefaz_unavailable_at?: string | null;
  sefaz_retry_at?: string | null;
}

export interface Company {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  owner_whatsapp_normalized?: string | null;
  owner_whatsapp_display?: string | null;
  group_id: string;
  created_at: string;
  updated_at: string;
  empresa?: Record<string, unknown> | null;
  endereco_principal?: Record<string, unknown> | null;
  focusnfe?: Record<string, unknown> | null;
  setup?: Record<string, unknown> | null;
  focus_cnpj_consulta?: Record<string, unknown> | null;
  onboarding_completed?: boolean;
  onboarding_fiscal?: OnboardingFiscalMetrics | null;
  onboarding_pdv?: {
    completed?: boolean;
    sync?: boolean;
    sales_total?: number;
    sales_sync?: number;
    portal_busy?: boolean;
    portal_outcome?: string | null;
    portal_message?: string | null;
    import_status?: string | null;
    import_error?: string | null;
  } | null;
  /** Preferências de notificação WhatsApp (número + regras). */
  notification?: CompanyNotificationEntry[] | null;
  /**
   * Dia de início da semana contábil (0=domingo … 6=sábado).
   * Default no banco: 1 (segunda-feira).
   */
  accounting_week_starts_on?: number | null;
}

export interface UserCompany {
  company: Company;
  role: UserCompanyRole;
  permissionProfileId: string | null;
  permissionProfileName: string | null;
  permissions: string[];
}

export interface GroupWithCompanies {
  group: CompanyGroup;
  companies: UserCompany[];
}

interface CompanyContextType {
  companies: Company[];
  userCompanies: UserCompany[];
  groups: CompanyGroup[];
  groupsWithCompanies: GroupWithCompanies[];
  currentCompany: Company | null;
  currentRole: UserCompanyRole | null;
  currentPermissions: string[];
  currentProfileName: string | null;
  isCompanyOwner: boolean;
  currentGroup: CompanyGroup | null;
  isGroupOwner: boolean;
  loading: boolean;
  setCurrentCompany: (company: Company | null) => void;
  refetchCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);
const LAST_COMPANY_KEY = "faro-last-company";

export function getLastCompanyStorageKey(userId: string) {
  return `${LAST_COMPANY_KEY}-${userId}`;
}


function parseRole(r: unknown): UserCompanyRole {
  if (r === "owner") return "owner";
  return "member";
}

type CompanyRow = Company & {
  company_groups: CompanyGroup | CompanyGroup[] | null;
};

type UcRow = {
  company_id: string;
  role: string;
  permission_profile_id: string | null;
  company_permission_profiles:
    | {
        id: string;
        name: string;
        permissions: unknown;
      }
    | {
        id: string;
        name: string;
        permissions: unknown;
      }[]
    | null;
};

function normalizePermissionProfile(
  raw: UcRow["company_permission_profiles"],
): {
  id: string;
  name: string;
  permissions: unknown;
} | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function permissionsForRole(
  role: UserCompanyRole,
  profilePerms: PermissionKey[],
): string[] {
  if (isOwnerRole(role)) return ["*"];
  return profilePerms;
}

function normalizeGroupEmbed(
  raw: CompanyRow["company_groups"],
): CompanyGroup | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function mergeCompanyFromRealtimeRow(
  prev: Company,
  raw: Record<string, unknown>,
): Company {
  const { company_groups: _g, ...rest } = raw;
  return { ...prev, ...(rest as Partial<Company>) };
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([]);
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(
    null,
  );
  const [currentRole, setCurrentRole] = useState<UserCompanyRole | null>(null);
  const [currentPermissions, setCurrentPermissions] = useState<string[]>([]);
  const [currentProfileName, setCurrentProfileName] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const applyActiveMembership = useCallback(
    (uc: UserCompany | undefined) => {
      if (isAdmin) {
        // Admin age com poder de proprietário em qualquer unidade, com ou sem membership.
        setCurrentRole("owner");
        setCurrentPermissions(["*"]);
        setCurrentProfileName(
          uc?.permissionProfileName === "Admin Faro"
            ? "Admin Faro"
            : isOwnerRole(uc?.role)
              ? "Proprietário"
              : (uc?.permissionProfileName ?? "Admin Faro"),
        );
        return;
      }
      setCurrentRole(uc?.role ?? null);
      setCurrentPermissions(uc?.permissions ?? []);
      setCurrentProfileName(
        isOwnerRole(uc?.role)
          ? "Proprietário"
          : (uc?.permissionProfileName ?? null),
      );
    },
    [isAdmin],
  );

  const fetchCompanies = useCallback(async () => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setCompanies([]);
      setUserCompanies([]);
      setGroups([]);
      setCurrentCompanyState(null);
      setCurrentRole(null);
      setCurrentPermissions([]);
      setCurrentProfileName(null);
      setLoading(false);
      return;
    }

    await acceptMyPendingPlatformAccess();

    const { data: ucData } = await supabase
      .from("user_companies")
      .select(
        "company_id, role, permission_profile_id, company_permission_profiles(id, name, permissions)",
      )
      .eq("user_id", user.id);

    const membershipByCompanyId = new Map(
      ((ucData ?? []) as unknown as UcRow[]).map((uc) => [uc.company_id, uc]),
    );

    let rows: CompanyRow[] = [];

    if (isAdmin) {
      const { data, error } = await supabase
        .from("companies")
        .select("*, company_groups(*)")
        .order("name", { ascending: true });
      if (error) {
        setCompanies([]);
        setUserCompanies([]);
        setGroups([]);
        setCurrentCompanyState(null);
        setCurrentRole(null);
        setCurrentPermissions([]);
        setCurrentProfileName(null);
        setLoading(false);
        return;
      }
      rows = (data ?? []) as CompanyRow[];
    } else {
      if (!ucData?.length) {
        setCompanies([]);
        setUserCompanies([]);
        setGroups([]);
        setCurrentCompanyState(null);
        setCurrentRole(null);
        setCurrentPermissions([]);
        setCurrentProfileName(null);
        setLoading(false);
        return;
      }

      const companyIds = ucData.map((uc) => uc.company_id);
      const { data, error } = await supabase
        .from("companies")
        .select("*, company_groups(*)")
        .in("id", companyIds);

      if (error) {
        setCompanies([]);
        setUserCompanies([]);
        setGroups([]);
        setCurrentCompanyState(null);
        setCurrentRole(null);
        setCurrentPermissions([]);
        setCurrentProfileName(null);
        setLoading(false);
        return;
      }
      rows = (data ?? []) as CompanyRow[];
    }

    const companyList: Company[] = rows.map((row) => {
      const { company_groups: _g, ...rest } = row;
      return rest as Company;
    });
    setCompanies(companyList);

    const groupById = new Map<string, CompanyGroup>();
    for (const row of rows) {
      const g = normalizeGroupEmbed(row.company_groups);
      if (g) groupById.set(g.id, g);
    }

    if (isAdmin) {
      const { data: allGroups } = await supabase
        .from("company_groups")
        .select("*")
        .order("name", { ascending: true });
      for (const g of (allGroups ?? []) as CompanyGroup[]) {
        groupById.set(g.id, g);
      }
    }

    const groupList = [...groupById.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    setGroups(groupList);

    const ucs: UserCompany[] = companyList.map((c) => {
      const uc = membershipByCompanyId.get(c.id);
      if (uc) {
        const role = parseRole(uc.role);
        const profile = normalizePermissionProfile(
          uc.company_permission_profiles,
        );
        const profilePerms = parsePermissionKeys(profile?.permissions);
        return {
          company: c,
          role,
          permissionProfileId: uc.permission_profile_id ?? null,
          permissionProfileName: profile?.name ?? null,
          permissions: isAdmin
            ? ["*"]
            : permissionsForRole(role, profilePerms),
        };
      }
      return {
        company: c,
        role: "member" as const,
        permissionProfileId: null,
        permissionProfileName: isAdmin ? "Admin Faro" : null,
        permissions: isAdmin ? ["*"] : [],
      };
    });
    setUserCompanies(ucs);

    const lastId = localStorage.getItem(getLastCompanyStorageKey(user.id));
    const lastUserCompany = lastId
      ? ucs.find((uc) => uc.company.id === lastId)
      : null;
    const active = lastUserCompany ?? ucs[0] ?? null;
    setCurrentCompanyState(active?.company ?? companyList[0] ?? null);
    applyActiveMembership(active ?? ucs[0]);
    setLoading(false);
  }, [user, isAdmin, authLoading, applyActiveMembership]);

  const groupsWithCompanies = useMemo(
    () =>
      groups.map((g) => ({
        group: g,
        companies: userCompanies.filter((uc) => uc.company.group_id === g.id),
      })),
    [groups, userCompanies],
  );

  const currentGroup = useMemo(() => {
    if (!currentCompany) return null;
    return groups.find((g) => g.id === currentCompany.group_id) ?? null;
  }, [currentCompany, groups]);

  const isGroupOwner = useMemo(() => {
    if (!user || !currentGroup) return false;
    if (isAdmin) return true;
    return currentGroup.owner_user_id === user.id;
  }, [user, currentGroup, isAdmin]);

  const isCompanyOwner = isOwnerRole(currentRole) || isAdmin;

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const applyActiveCompanyRealtime = useCallback(
    (raw: Record<string, unknown>) => {
      const id =
        typeof raw.id === "string"
          ? raw.id
          : raw.id != null
            ? String(raw.id)
            : "";
      if (!id) return;

      setCompanies((list) =>
        list.map((c) =>
          c.id === id ? mergeCompanyFromRealtimeRow(c, raw) : c,
        ),
      );
      setUserCompanies((ucs) =>
        ucs.map((uc) =>
          uc.company.id === id
            ? {
                ...uc,
                company: mergeCompanyFromRealtimeRow(uc.company, raw),
              }
            : uc,
        ),
      );
      setCurrentCompanyState((cur) =>
        cur?.id === id ? mergeCompanyFromRealtimeRow(cur, raw) : cur,
      );
    },
    [],
  );

  useEffect(() => {
    const companyId = currentCompany?.id;
    if (!companyId || !user) return;

    const channel = supabase
      .channel(`companies:active:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "companies",
          filter: `id=eq.${companyId}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            applyActiveCompanyRealtime(
              payload.new as Record<string, unknown>,
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "companies",
          filter: `id=eq.${companyId}`,
        },
        () => {
          void fetchCompanies();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentCompany?.id, user, applyActiveCompanyRealtime, fetchCompanies]);

  const setCurrentCompany = useCallback(
    (company: Company | null) => {
      const uc = company
        ? userCompanies.find((u) => u.company.id === company.id)
        : null;
      setCurrentCompanyState(company);
      applyActiveMembership(uc ?? undefined);
      if (user && company) {
        localStorage.setItem(getLastCompanyStorageKey(user.id), company.id);
      }
    },
    [user, userCompanies, applyActiveMembership],
  );

  return (
    <CompanyContext.Provider
      value={{
        companies,
        userCompanies,
        groups,
        groupsWithCompanies,
        currentCompany,
        currentRole,
        currentPermissions,
        currentProfileName,
        isCompanyOwner,
        currentGroup,
        isGroupOwner,
        loading,
        setCurrentCompany,
        refetchCompanies: fetchCompanies,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return context;
}

export function useHasPermission(key: PermissionKey): boolean {
  const { currentPermissions, isCompanyOwner } = useCompany();
  const { isAdmin } = useAuth();
  if (isAdmin) return true;
  if (isCompanyOwner) return true;
  return hasPermission(currentPermissions, key);
}

/** Proprietário da unidade **ou** admin global Faro. */
export function useIsOwnerAccess(): boolean {
  const { isCompanyOwner } = useCompany();
  const { isAdmin } = useAuth();
  return isAdmin || isCompanyOwner;
}

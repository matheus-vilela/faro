import type { UserCompanyRole } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyGroup } from "@/types/companyGroup";
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
  /** Etapa fiscal concluída (confirmação manual no dashboard). */
  completed?: boolean;
  /** SEFAZ/Focus sem resposta no sync de onboarding. */
  sefaz_unavailable?: boolean;
  sefaz_unavailable_at?: string | null;
  /** Próxima tentativa automática (cron 30 min). */
  sefaz_retry_at?: string | null;
}

export interface Company {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  /** WhatsApp: proprietário (normalizado para validação webhook). */
  owner_whatsapp_normalized?: string | null;
  owner_whatsapp_display?: string | null;
  group_id: string;
  created_at: string;
  updated_at: string;
  /** Maps JSON persistidos pelo assistente de configuração (quando existirem). */
  empresa?: Record<string, unknown> | null;
  endereco_principal?: Record<string, unknown> | null;
  focusnfe?: Record<string, unknown> | null;
  setup?: Record<string, unknown> | null;
  focus_cnpj_consulta?: Record<string, unknown> | null;
  /** Onboarding: ver migration `company_onboarding_flags`; `onboarding_completed` é derivado no Postgres. */
  onboarding_completed?: boolean;
  /** Métricas do card NF-e recebidas (sync, completed, max_nfes_sync, nfes_sync, nfes_ignored). */
  onboarding_fiscal?: OnboardingFiscalMetrics | null;
  /** Onboarding PDV/EPOC: `completed`, `sync`. */
  onboarding_pdv?: { completed?: boolean; sync?: boolean } | null;
}

export interface UserCompany {
  company: Company;
  role: UserCompanyRole;
}

export interface GroupWithCompanies {
  group: CompanyGroup;
  companies: UserCompany[];
}

interface CompanyContextType {
  companies: Company[];
  userCompanies: UserCompany[];
  /** Grupos distintos aos quais o usuário tem acesso (via empresas). */
  groups: CompanyGroup[];
  /** Grupos com empresas aninhadas (para UI). */
  groupsWithCompanies: GroupWithCompanies[];
  currentCompany: Company | null;
  currentRole: UserCompanyRole | null;
  /** Grupo da empresa atualmente selecionada. */
  currentGroup: CompanyGroup | null;
  /** Usuário logado é dono do grupo atual (pode renomear grupo e gerenciar unidades). */
  isGroupOwner: boolean;
  loading: boolean;
  setCurrentCompany: (company: Company | null) => void;
  refetchCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);
const LAST_COMPANY_KEY = "faro-last-company";

/** Chave usada para lembrar a última empresa selecionada (localStorage). */
export function getLastCompanyStorageKey(userId: string) {
  return `${LAST_COMPANY_KEY}-${userId}`;
}

const VALID_ROLES = ["operador", "gestor", "owner"] as const;
function parseRole(r: unknown): UserCompanyRole {
  return VALID_ROLES.includes(r as UserCompanyRole)
    ? (r as UserCompanyRole)
    : "operador";
}

type CompanyRow = Company & {
  company_groups: CompanyGroup | CompanyGroup[] | null;
};

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
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([]);
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(
    null,
  );
  const [currentRole, setCurrentRole] = useState<UserCompanyRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([]);
      setUserCompanies([]);
      setGroups([]);
      setCurrentCompanyState(null);
      setCurrentRole(null);
      setLoading(false);
      return;
    }

    const { data: ucData } = await supabase
      .from("user_companies")
      .select("company_id, role")
      .eq("user_id", user.id);

    if (!ucData?.length) {
      setCompanies([]);
      setUserCompanies([]);
      setGroups([]);
      setCurrentCompanyState(null);
      setCurrentRole(null);
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
    } else {
      const rows = (data ?? []) as CompanyRow[];
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
      const groupList = [...groupById.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR"),
      );
      setGroups(groupList);

      const ucs: UserCompany[] = companyList.map((c) => {
        const uc = ucData.find((u) => u.company_id === c.id);
        return { company: c, role: parseRole(uc?.role) };
      });
      setUserCompanies(ucs);

      const lastId = localStorage.getItem(getLastCompanyStorageKey(user.id));
      const lastUserCompany = lastId
        ? ucs.find((uc) => uc.company.id === lastId)
        : null;
      setCurrentCompanyState(
        lastUserCompany?.company ?? companyList[0] ?? null,
      );
      setCurrentRole(lastUserCompany?.role ?? ucs[0]?.role ?? null);
    }
    setLoading(false);
  }, [user]);

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
    return currentGroup.owner_user_id === user.id;
  }, [user, currentGroup]);

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

  /** Postgres changes na empresa selecionada (ex.: onboarding_fiscal, focusnfe). */
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
      setCurrentRole(uc?.role ?? null);
      if (user && company) {
        localStorage.setItem(getLastCompanyStorageKey(user.id), company.id);
      }
    },
    [user, userCompanies],
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

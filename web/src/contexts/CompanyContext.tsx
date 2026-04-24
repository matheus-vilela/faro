import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserCompanyRole } from '@/lib/roles'
import type { CompanyGroup } from '@/types/companyGroup'
import { useAuth } from './AuthContext'

export interface Company {
  id: string
  name: string
  document: string | null
  email: string | null
  phone: string | null
  address: string | null
  /** WhatsApp: proprietário (normalizado para validação webhook). */
  owner_whatsapp_normalized?: string | null
  owner_whatsapp_display?: string | null
  group_id: string
  created_at: string
  updated_at: string
  /** Maps JSON persistidos pelo assistente de configuração (quando existirem). */
  empresa?: Record<string, unknown> | null
  endereco_principal?: Record<string, unknown> | null
  focusnfe?: Record<string, unknown> | null
  setup?: Record<string, unknown> | null
  focus_cnpj_consulta?: Record<string, unknown> | null
  representante_legal?: Record<string, unknown> | null
}

export interface UserCompany {
  company: Company
  role: UserCompanyRole
}

export interface GroupWithCompanies {
  group: CompanyGroup
  companies: UserCompany[]
}

interface CompanyContextType {
  companies: Company[]
  userCompanies: UserCompany[]
  /** Grupos distintos aos quais o usuário tem acesso (via empresas). */
  groups: CompanyGroup[]
  /** Grupos com empresas aninhadas (para UI). */
  groupsWithCompanies: GroupWithCompanies[]
  currentCompany: Company | null
  currentRole: UserCompanyRole | null
  /** Grupo da empresa atualmente selecionada. */
  currentGroup: CompanyGroup | null
  /** Usuário logado é dono do grupo atual (pode renomear grupo e gerenciar unidades). */
  isGroupOwner: boolean
  loading: boolean
  setCurrentCompany: (company: Company | null) => void
  refetchCompanies: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)
const LAST_COMPANY_KEY = 'faro-last-company'

/** Chave usada para lembrar a última empresa selecionada (localStorage). */
export function getLastCompanyStorageKey(userId: string) {
  return `${LAST_COMPANY_KEY}-${userId}`
}

const VALID_ROLES = ['operador', 'gestor', 'owner'] as const
function parseRole(r: unknown): UserCompanyRole {
  return VALID_ROLES.includes(r as UserCompanyRole) ? (r as UserCompanyRole) : 'operador'
}

type CompanyRow = Company & {
  company_groups: CompanyGroup | CompanyGroup[] | null
}

function normalizeGroupEmbed(
  raw: CompanyRow['company_groups'],
): CompanyGroup | null {
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([])
  const [groups, setGroups] = useState<CompanyGroup[]>([])
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(null)
  const [currentRole, setCurrentRole] = useState<UserCompanyRole | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([])
      setUserCompanies([])
      setGroups([])
      setCurrentCompanyState(null)
      setCurrentRole(null)
      setLoading(false)
      return
    }

    const { data: ucData } = await supabase
      .from('user_companies')
      .select('company_id, role')
      .eq('user_id', user.id)

    if (!ucData?.length) {
      setCompanies([])
      setUserCompanies([])
      setGroups([])
      setCurrentCompanyState(null)
      setCurrentRole(null)
      setLoading(false)
      return
    }

    const companyIds = ucData.map((uc) => uc.company_id)
    const { data, error } = await supabase
      .from('companies')
      .select('*, company_groups(*)')
      .in('id', companyIds)

    if (error) {
      setCompanies([])
      setUserCompanies([])
      setGroups([])
      setCurrentCompanyState(null)
      setCurrentRole(null)
    } else {
      const rows = (data ?? []) as CompanyRow[]
      const companyList: Company[] = rows.map((row) => {
        const { company_groups: _g, ...rest } = row
        return rest as Company
      })
      setCompanies(companyList)

      const groupById = new Map<string, CompanyGroup>()
      for (const row of rows) {
        const g = normalizeGroupEmbed(row.company_groups)
        if (g) groupById.set(g.id, g)
      }
      const groupList = [...groupById.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR'),
      )
      setGroups(groupList)

      const ucs: UserCompany[] = companyList.map((c) => {
        const uc = ucData.find((u) => u.company_id === c.id)
        return { company: c, role: parseRole(uc?.role) }
      })
      setUserCompanies(ucs)

      const lastId = localStorage.getItem(getLastCompanyStorageKey(user.id))
      const lastUserCompany = lastId ? ucs.find((uc) => uc.company.id === lastId) : null
      setCurrentCompanyState(lastUserCompany?.company ?? companyList[0] ?? null)
      setCurrentRole(lastUserCompany?.role ?? ucs[0]?.role ?? null)
    }
    setLoading(false)
  }, [user])

  const groupsWithCompanies = useMemo(
    () =>
      groups.map((g) => ({
        group: g,
        companies: userCompanies.filter((uc) => uc.company.group_id === g.id),
      })),
    [groups, userCompanies],
  )

  const currentGroup = useMemo(() => {
    if (!currentCompany) return null
    return groups.find((g) => g.id === currentCompany.group_id) ?? null
  }, [currentCompany, groups])

  const isGroupOwner = useMemo(() => {
    if (!user || !currentGroup) return false
    return currentGroup.owner_user_id === user.id
  }, [user, currentGroup])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const setCurrentCompany = useCallback((company: Company | null) => {
    const uc = company ? userCompanies.find((u) => u.company.id === company.id) : null
    setCurrentCompanyState(company)
    setCurrentRole(uc?.role ?? null)
    if (user && company) {
      localStorage.setItem(getLastCompanyStorageKey(user.id), company.id)
    }
  }, [user, userCompanies])

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
  )
}

export function useCompany() {
  const context = useContext(CompanyContext)
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserCompanyRole } from '@/lib/roles'
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
  created_at: string
  updated_at: string
}

export interface UserCompany {
  company: Company
  role: UserCompanyRole
}

interface CompanyContextType {
  companies: Company[]
  userCompanies: UserCompany[]
  currentCompany: Company | null
  currentRole: UserCompanyRole | null
  loading: boolean
  setCurrentCompany: (company: Company | null) => void
  refetchCompanies: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)
const LAST_COMPANY_KEY = 'faro-last-company'

function getLastCompanyKey(userId: string) {
  return `${LAST_COMPANY_KEY}-${userId}`
}

const VALID_ROLES = ['operador', 'gestor', 'owner'] as const
function parseRole(r: unknown): UserCompanyRole {
  return VALID_ROLES.includes(r as UserCompanyRole) ? (r as UserCompanyRole) : 'operador'
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([])
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(null)
  const [currentRole, setCurrentRole] = useState<UserCompanyRole | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([])
      setUserCompanies([])
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
      setCurrentCompanyState(null)
      setCurrentRole(null)
      setLoading(false)
      return
    }

    const companyIds = ucData.map((uc) => uc.company_id)
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .in('id', companyIds)

    if (error) {
      setCompanies([])
      setUserCompanies([])
      setCurrentCompanyState(null)
      setCurrentRole(null)
    } else {
      const companyList = (data ?? []) as Company[]
      setCompanies(companyList)
      const ucs: UserCompany[] = companyList.map((c) => {
        const uc = ucData.find((u) => u.company_id === c.id)
        return { company: c, role: parseRole(uc?.role) }
      })
      setUserCompanies(ucs)
      const lastId = localStorage.getItem(getLastCompanyKey(user.id))
      const lastUserCompany = lastId ? ucs.find((uc) => uc.company.id === lastId) : null
      setCurrentCompanyState(lastUserCompany?.company ?? companyList[0] ?? null)
      setCurrentRole(lastUserCompany?.role ?? ucs[0]?.role ?? null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const setCurrentCompany = useCallback((company: Company | null) => {
    const uc = company ? userCompanies.find((u) => u.company.id === company.id) : null
    setCurrentCompanyState(company)
    setCurrentRole(uc?.role ?? null)
    if (user && company) {
      localStorage.setItem(getLastCompanyKey(user.id), company.id)
    }
  }, [user, userCompanies])

  return (
    <CompanyContext.Provider
      value={{
        companies,
        userCompanies,
        currentCompany,
        currentRole,
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

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthContext'

export interface Company {
  id: string
  name: string
  document: string | null
  email: string | null
  phone: string | null
  address: string | null
  created_at: string
  updated_at: string
}

interface CompanyContextType {
  companies: Company[]
  currentCompany: Company | null
  loading: boolean
  setCurrentCompany: (company: Company | null) => void
  refetchCompanies: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)
const LAST_COMPANY_KEY = 'faro-last-company'

function getLastCompanyKey(userId: string) {
  return `${LAST_COMPANY_KEY}-${userId}`
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    if (!user) {
      setCompanies([])
      setCurrentCompanyState(null)
      setLoading(false)
      return
    }

    const { data: userCompanies } = await supabase
      .from('user_companies')
      .select('company_id')
      .eq('user_id', user.id)

    if (!userCompanies?.length) {
      setCompanies([])
      setCurrentCompanyState(null)
      setLoading(false)
      return
    }

    const companyIds = userCompanies.map((uc) => uc.company_id)
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .in('id', companyIds)

    if (error) {
      setCompanies([])
      setCurrentCompanyState(null)
    } else {
      const companyList = (data ?? []) as Company[]
      setCompanies(companyList)
      const lastId = user ? localStorage.getItem(getLastCompanyKey(user.id)) : null
      const lastCompany = lastId ? companyList.find((c) => c.id === lastId) : null
      setCurrentCompanyState(lastCompany ?? null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const setCurrentCompany = useCallback((company: Company | null) => {
    setCurrentCompanyState(company)
    if (user && company) {
      localStorage.setItem(getLastCompanyKey(user.id), company.id)
    }
  }, [user])

  return (
    <CompanyContext.Provider
      value={{
        companies,
        currentCompany,
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

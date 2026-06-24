import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  /** `profiles.is_admin` — só alterável via SQL no Supabase. */
  isAdmin: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function syncProfileAdmin(userId: string | undefined) {
      if (!userId) {
        setIsAdmin(false)
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.warn('[AuthContext] profiles.is_admin:', error.message)
        setIsAdmin(false)
        return
      }
      setIsAdmin(data?.is_admin === true)
    }

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      await syncProfileAdmin(session?.user?.id)
      if (!cancelled) setLoading(false)
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      void syncProfileAdmin(session?.user?.id)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    setIsAdmin(false)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

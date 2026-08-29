import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, configured } from './supabase'

const AuthCtx = createContext({ session: null, staff: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [staff, setStaff] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!configured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setStaff(null); setLoading(false) } })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    setLoading(true)
    supabase.from('staff').select('id,email,full_name,role,is_active').limit(1).maybeSingle()
      .then(({ data }) => { if (alive) { setStaff(data || null); setLoading(false) } })
    return () => { alive = false }
  }, [session])

  const signOut = () => supabase?.auth.signOut()
  return <AuthCtx.Provider value={{ session, staff, loading, signOut }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

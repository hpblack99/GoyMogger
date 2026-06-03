import { useEffect, useState, createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import LoginPage from './LoginPage'

interface AuthCtx { user: User }
const Ctx = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(Ctx)

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (user === undefined) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0d1117', color:'#8b949e', fontSize:'0.9rem' }}>
      Loading…
    </div>
  )
  if (!user) return <LoginPage />
  return <Ctx.Provider value={{ user }}>{children}</Ctx.Provider>
}

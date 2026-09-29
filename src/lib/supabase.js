import { createClient } from '@supabase/supabase-js'
import { isDemo, demoClient } from './demo'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

const demo = isDemo()
export const configured = demo || Boolean(url && anon)

export const supabase = demo ? demoClient : configured
  ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

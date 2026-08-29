import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
  }

  return (
    <div className="login">
      <div className="card">
        <div className="brand"><img src="/favicon.svg" alt="" /><div><strong>WSFC Club CRM</strong><span>Whakatane Sportfishing Club</span></div></div>
        {sent ? (
          <div className="alert ok">Check your inbox. We sent a sign-in link to <b>{email}</b>. It opens this console.</div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: '.75rem' }}>
            <p className="muted small">Staff and committee sign in with a magic link. No passwords.</p>
            <label className="f">Email
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@wsfc.co.nz" />
            </label>
            {err && <div className="alert err">{err}</div>}
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

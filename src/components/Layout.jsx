import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const links = [
  ['/', 'Dashboard'],
  ['/members', 'Members'],
  ['/contacts', 'Email contacts'],
  ['/status', 'Status programme'],
  ['/checkins', 'Check-in codes'],
  ['/notify', 'Notifications'],
  ['/merch', 'Merchandise'],
  ['/subscriptions', 'Subscriptions'],
  ['/uptake', 'App uptake'],
  ['/import', 'Import'],
  ['/staff', 'Staff'],
]

export default function Layout({ children }) {
  const { staff, signOut } = useAuth()
  const [admin, setAdmin] = useState(null)
  useEffect(() => { if (staff?.role === 'readonly') supabase.from('staff').select('full_name, email').eq('role', 'admin').eq('is_active', true).order('created_at').limit(1).maybeSingle().then(({ data }) => setAdmin(data)) }, [staff?.role])
  const first = (n) => (n || '').split(' ')[0]
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/wsfc-logo-256.png" alt="Whakatane Sportfishing Club" />
          <div><strong>WSFC Club CRM</strong><span>Whakatane Sportfishing Club</span></div>
        </div>
        <nav className="nav">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
        <div className="foot">
          <div>{staff?.full_name || staff?.email}</div>
          <div>{staff?.role}</div>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main watermark">
        {staff?.role === 'readonly' && <div className="alert" style={{ marginBottom: '1rem' }}>Kia ora {first(staff.full_name) || 'there'}, you have a look around pass: every page is open to you, nothing you click will change anything. Want to edit something? Give {admin ? first(admin.full_name) || admin.email : 'Paul'} a shout.</div>}
        {children}
      </main>
    </div>
  )
}

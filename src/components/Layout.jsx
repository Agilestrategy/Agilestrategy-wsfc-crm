import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const links = [
  ['/', 'Dashboard'],
  ['/members', 'Members'],
  ['/contacts', 'Email contacts'],
  ['/status', 'Status programme'],
  ['/checkins', 'Check-in codes'],
  ['/notify', 'Notifications'],
  ['/import', 'Import'],
  ['/staff', 'Staff'],
]

export default function Layout({ children }) {
  const { staff, signOut } = useAuth()
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
      <main className="main watermark">{children}</main>
    </div>
  )
}

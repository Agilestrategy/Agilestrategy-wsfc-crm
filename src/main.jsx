import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './lib/auth'
import { configured } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Members from './pages/Members'
import MemberDetail from './pages/MemberDetail'
import Contacts from './pages/Contacts'
import ImportPage from './pages/Import'
import Staff from './pages/Staff'
import Status from './pages/Status'
import Checkins from './pages/Checkins'
import Notify from './pages/Notify'
import MemberApp from './me/MemberApp'

function Gate({ children }) {
  const { session, staff, loading } = useAuth()
  if (!configured) return <Setup />
  if (loading) return <div className="login"><div className="card">Loading…</div></div>
  if (!session) return <Login />
  if (!staff) return <NotStaff />
  return children
}

function Setup() {
  return (
    <div className="login"><div className="card">
      <h1>WSFC Club CRM</h1>
      <p>Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (in <code>.env</code> locally, or Netlify environment variables) and rebuild.</p>
    </div></div>
  )
}

function NotStaff() {
  const { session, signOut } = useAuth()
  return (
    <div className="login"><div className="card">
      <h1>Not authorised</h1>
      <p>{session.user.email} is signed in but is not on the staff list. Ask an admin to add you, then sign in again.</p>
      <button className="btn" onClick={signOut}>Sign out</button>
    </div></div>
  )
}

function Console() {
  return (
    <AuthProvider>
      <Gate>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/members" element={<Members />} />
            <Route path="/members/:id" element={<MemberDetail />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/status" element={<Status />} />
            <Route path="/checkins" element={<Checkins />} />
            <Route path="/notify" element={<Notify />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Gate>
    </AuthProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/me/*" element={<MemberApp />} />
        <Route path="/*" element={<Console />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)

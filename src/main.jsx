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
import Merch from './pages/Merch'
import Uptake from './pages/Uptake'
import Subscriptions from './pages/Subscriptions'
import MemberApp from './me/MemberApp'
import DemoGate from './me/Demo'
import { isDemo, endDemo } from './lib/demo'

function Gate({ children }) {
  const { session, staff, loading } = useAuth()
  if (isDemo()) return <DemoOn />
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

function DemoOn() {
  return (
    <div className="login"><div className="card">
      <h1>Demo mode is on</h1>
      <p>This browser is running the member app demo, so the staff console is switched off. <a href="/me">Back to the demo</a>, or leave it to use the console.</p>
      <button className="btn" onClick={() => { endDemo(); window.location.reload() }}>Leave the demo</button>
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
            <Route path="/merch" element={<Merch />} />
            <Route path="/uptake" element={<Uptake />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
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
        <Route path="/demo" element={<DemoGate />} />
        <Route path="/*" element={<Console />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)

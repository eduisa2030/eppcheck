import { useState } from 'react'
import Login from './pages/Login'
import Home from './pages/Home'
import Scan from './pages/Scan'
import History from './pages/History'
import Reports from './pages/Reports'
import Alerts from './pages/Alerts'
import Capture from './pages/Capture'
import Profile from './pages/Profile'
import Settings from './pages/Settings'

export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('home')

  if (!user) return <Login onLogin={setUser} />

  const logout = () => {
    setUser(null)
    setPage('home')
  }

  return (
    <div className="min-h-screen bg-[#0B0B12] text-white max-w-md mx-auto relative">
      {page === 'home' && <Home user={user} onNavigate={setPage} />}
      {page === 'scan' && <Scan onBack={() => setPage('home')} />}
      {page === 'history' && <History onBack={() => setPage('home')} />}
      {page === 'reports' && <Reports onBack={() => setPage('home')} />}
      {page === 'alerts' && <Alerts onBack={() => setPage('home')} />}
      {page === 'capture' && <Capture onBack={() => setPage('home')} />}
      {page === 'profile' && <Profile user={user} onLogout={logout} onBack={() => setPage('home')} onNavigate={setPage} />}
      {page === 'settings' && <Settings onBack={() => setPage('home')} />}
      {page === 'capture' && <Capture onBack={() => setPage('home')} />}

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto h-[92px] bg-gradient-to-t from-[#0C0C14] via-[#0C0C14]/95 to-transparent border-t border-white/5 flex items-start justify-around pt-3 pb-6 px-2 z-50">
        <Tab icon="home" label="Inicio" active={page==='home'} onClick={() => setPage('home')} />
        <Tab icon="history" label="Historial" active={page==='history'} onClick={() => setPage('history')} />
        <div className="relative -mt-5">
          <button onClick={() => setPage('scan')} className="w-[62px] h-[62px] rounded-full bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] flex items-center justify-center shadow-[0_0_28px_rgba(255,194,26,0.5)] text-black">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <Tab icon="chart" label="Reportes" active={page==='reports'} onClick={() => setPage('reports')} />
        <Tab icon="user" label="Perfil" active={page==='profile'} onClick={() => setPage('profile')} />
      </nav>
    </div>
  )
}

function Tab({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 pt-1 ${active ? 'text-[#FFC21A]' : 'text-[#7A7A88]'}`}>
      <div className="w-6 h-6 flex items-center justify-center">
        {icon === 'home' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>}
        {icon === 'history' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        {icon === 'chart' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>}
        {icon === 'user' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

import { useEffect, useState } from 'react'
import { getStats } from '../lib/stats'
import { modelStatusText, subscribeModelProgress } from '../lib/modelCache'

export default function Home({ user, onNavigate }) {
  const [stats, setStats] = useState(getStats())
  const [modelProgress, setModelProgress] = useState({ ready: false, loaded: 0, total: 0 })

  useEffect(() => {
    const refresh = () => setStats(getStats())
    window.addEventListener('focus', refresh)
    const unsub = subscribeModelProgress(setModelProgress)
    return () => {
      window.removeEventListener('focus', refresh)
      unsub()
    }
  }, [])

  const pct = stats.porcentaje || 0

  return (
    <div className="pb-28 px-5 pt-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-b from-[#2A2618] to-[#1A1810] border border-[#FFC21A]/30 flex items-center justify-center font-bold text-[#FFC21A] text-sm">
            {user.name.slice(0,2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold">Hola, {user.name}</h1>
            <p className="text-xs text-[#8A8A98]">Operador · EPPCheck</p>
          </div>
        </div>
      </div>

      <div className="bg-[#15151F] border border-white/5 rounded-3xl p-4 mb-4 flex items-center gap-4">
        <div className="relative w-28 h-28 flex-none">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" stroke="#232330" strokeWidth="8" fill="none"/>
            <circle cx="50" cy="50" r="42" stroke="#FFC21A" strokeWidth="8" fill="none" 
              strokeDasharray="264" strokeDashoffset={264 - (264 * pct / 100)} strokeLinecap="round"/>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold">{pct}%</span>
            <span className="text-[10px] text-[#8A8A98]">CUMPLE</span>
          </div>
        </div>
        <div>
          <p className="text-[11px] tracking-widest text-[#8A8A98] mb-1">CUMPLIMIENTO</p>
          <p className="text-sm">{stats.cumple} de {stats.total} escaneos</p>
          <p className="text-xs text-[#8A8A98] mt-1">{stats.noCumple} no cumplieron</p>
        </div>
      </div>

      <button onClick={() => onNavigate('scan')} className="w-full bg-gradient-to-b from-[#FFD65A] to-[#FFC21A] text-black font-semibold py-4 rounded-2xl mb-6">
        Escanear EPP
      </button>
      {modelStatusText(modelProgress) && (
          <p className="text-center text-[#8A8A98] text-xs -mt-4 mb-6">{modelStatusText(modelProgress)}</p>
        )}

      <div>
        <div className="flex justify-between mb-2 px-1">
          <p className="text-[11px] tracking-widest text-[#8A8A98]">ÚLTIMOS ESCANEOS</p>
          <button onClick={() => onNavigate('history')} className="text-xs text-[#FFC21A]">Ver todos</button>
        </div>
        {stats.recientes.length === 0 ? (
          <p className="text-sm text-[#8A8A98] text-center py-8">Aún no hay escaneos</p>
        ) : (
          <div className="space-y-2">
            {stats.recientes.map((s, i) => (
              <div key={i} className="bg-[#15151F] border border-white/5 rounded-2xl p-3 flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium">{new Date(s.timestamp).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})}</p>
                  <p className="text-xs text-[#8A8A98]">{s.cumple ? 'Completo' : `Falta: ${(s.missing||[]).join(', ')}`}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.cumple ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {s.cumple ? 'Cumple' : 'No cumple'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

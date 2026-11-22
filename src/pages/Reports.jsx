import { useState, useEffect } from 'react'
import { getStats } from '../lib/stats'

export default function Reports({ onBack }) {
  const [stats, setStats] = useState(getStats())

  useEffect(() => {
    setStats(getStats())
  }, [])

  const maxFalta = Math.max(...Object.values(stats.porElemento), 1)

  return (
    <div className="p-5 pb-28">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[#8A8A98]">←</button>
        <h1 className="text-2xl font-bold">Reportes</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4">
          <p className="text-[10px] tracking-wider text-[#8A8A98]">CUMPLIMIENTO</p>
          <p className="text-3xl font-bold mt-1">{stats.porcentaje}%</p>
          <p className="text-xs text-[#8A8A98] mt-1">{stats.cumple}/{stats.total} escaneos</p>
        </div>
        <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4">
          <p className="text-[10px] tracking-wider text-[#8A8A98]">NO CUMPLEN</p>
          <p className="text-3xl font-bold mt-1">{stats.noCumple}</p>
          <p className="text-xs text-[#8A8A98] mt-1">de {stats.total}</p>
        </div>
      </div>

      <div className="bg-[#15151F] border border-white/5 rounded-2xl p-4">
        <p className="text-[11px] tracking-wider text-[#8A8A98] mb-4">ELEMENTOS QUE MÁS FALLAN</p>
        {Object.entries(stats.porElemento).map(([item, count]) => (
          <div key={item} className="flex items-center gap-3 mb-3">
            <span className="w-16 text-sm capitalize">{item}</span>
            <div className="flex-1 h-2 bg-[#232330] rounded-full overflow-hidden">
              <div className="h-full bg-[#FFC21A]" style={{ width: `${(count / maxFalta) * 100}%` }} />
            </div>
            <span className="text-sm font-medium w-6 text-right">{count}</span>
          </div>
        ))}
        {stats.total === 0 && <p className="text-sm text-[#8A8A98] text-center py-4">Sin datos aún</p>}
      </div>
    </div>
  )
}

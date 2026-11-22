import { useEffect, useState } from 'react'
import { getHistory } from '../lib/storage'

export default function History({ onBack }) {
  const [scans, setScans] = useState([])

  useEffect(() => {
    setScans(getHistory())
  }, [])

  return (
    <div className="p-5 pb-28">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[#8A8A98] text-xl">←</button>
        <h1 className="text-2xl font-bold">Historial</h1>
      </div>
      {scans.length === 0 ? (
        <p className="text-[#8A8A98] text-center mt-20">Aún no hay escaneos guardados</p>
      ) : (
        <div className="space-y-3">
          {scans.map(s => (
            <div key={s.id} className="bg-[#15151F] border border-white/5 rounded-2xl p-4 flex justify-between items-center">
              <div>
                <p className="font-medium text-sm">{new Date(s.timestamp).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</p>
                <p className="text-xs text-[#8A8A98]">{new Date(s.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="text-right">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.cumple ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {s.cumple ? 'Cumple' : 'No cumple'}
                </span>
                {s.missing?.length > 0 && <p className="text-[11px] text-red-300 mt-1">{s.missing.join(', ')}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

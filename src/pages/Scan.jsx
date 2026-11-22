import { useEffect, useRef, useState } from 'react'
import { saveScan as saveLocal } from '../lib/storage'
import { saveScan as saveRemote } from '../lib/api'
import { vibrate, playBeep } from '../lib/feedback'
import { ITEM_CLASSES, ITEMS } from '../lib/models'

export default function Scan({ onBack, user }) {
  const videoRef = useRef(null)
  const [results, setResults] = useState({})
  const [frozen, setFrozen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reported, setReported] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const prevCumple = useRef(null)
  const operator = user?.name || user?.user || 'Operador'

  useEffect(() => {
    let stream
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => setCameraError('No se pudo acceder a la cámara. Revisa los permisos.'))

    const interval = setInterval(() => {
      if (frozen) return
      const mock = {}
      ITEMS.forEach(item => {
        const r = Math.random()
        mock[item] = {
          status: r > 0.52 ? 'bien' : r > 0.28 ? 'mal' : 'sin',
          conf: +(0.76 + Math.random() * 0.2).toFixed(2)
        }
      })
      setResults(mock)
    }, 1400)

    return () => {
      clearInterval(interval)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [frozen])

  useEffect(() => {
    const cumpleNow = ITEMS.every(i => results[i]?.status === 'bien')
    if (prevCumple.current !== null && prevCumple.current !== cumpleNow && Object.keys(results).length && !frozen) {
      vibrate(cumpleNow ? 40 : [30, 40, 30])
      playBeep(cumpleNow)
    }
    prevCumple.current = cumpleNow
  }, [results, frozen])

  const cumple = ITEMS.every(i => results[i]?.status === 'bien')
  const problemas = ITEMS.filter(i => results[i] && results[i].status !== 'bien')
  const criticos = problemas.filter(i => i === 'casco' || i === 'chaleco')

  const confirmResult = async () => {
    setFrozen(true)
    const data = {
      cumple,
      missing: problemas,
      details: results,
      user: operator,
      timestamp: new Date().toISOString()
    }
    saveLocal(data)
    await saveRemote(data)
    setSaved(true)
  }

  const handleReport = () => {
    saveLocal({ cumple: false, missing: ['REPORTE'], details: results, user: operator })
    setReported(true)
  }

  const badge = s => s === 'bien' ? 'bg-emerald-500' : s === 'mal' ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col">
      <div className="relative mx-5 mt-5 rounded-3xl overflow-hidden bg-black" style={{height:'36vh'}}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2.5 py-1 rounded-full text-[11px]">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> EN VIVO
        </div>
        <button onClick={onBack} className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur rounded-full flex items-center justify-center">✕</button>
        {cameraError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center text-sm">
            {cameraError}
          </div>
        )}
      </div>

      {/* Resultado principal */}
      <div className="px-5 mt-4">
        <div className={`rounded-2xl py-4 text-center ${cumple ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-red-500/15 border border-red-500/30'}`}>
          <p className={`text-lg font-bold ${cumple ? 'text-emerald-400' : 'text-red-400'}`}>
            {cumple ? 'AUTORIZADO PARA CHECAR' : 'NO AUTORIZADO'}
          </p>
          <p className="text-xs mt-1 text-[#C8C8D0]">
            {cumple ? 'EPP completo' : 'Completa tu equipo antes de checar'}
          </p>
        </div>
        {criticos.length > 0 && (
          <p className="text-center text-xs text-red-400 mt-2 font-medium">Falta crítico: {criticos.join(', ')}</p>
        )}
      </div>

      {/* Detalles */}
      <div className="mx-5 mt-3 bg-[#12121A] rounded-2xl p-4 border border-white/5">
        <p className="text-[10px] tracking-widest text-[#6E6E7C] mb-3">DETALLE · {operator}</p>
        <div className="space-y-2.5">
          {ITEMS.map(item => {
            const r = results[item]
            if (!r) return null
            const label = ITEM_CLASSES[item]?.[r.status] || r.status
            return (
              <div key={item} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-black font-bold ${badge(r.status)}`}>
                  {r.status === 'bien' ? '✓' : '!'}
                </div>
                <span className="capitalize flex-1 text-sm">{item}</span>
                <span className="text-xs text-[#C8C8D0]">{label}</span>
                <span className="text-[11px] w-8 text-right text-[#8A8A98]">{Math.round(r.conf * 100)}%</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Acciones */}
      <div className="px-5 pt-4 pb-8 flex gap-2">
        {!frozen ? (
          <button onClick={confirmResult} className="flex-1 bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-3.5 rounded-xl text-sm">
            Confirmar resultado
          </button>
        ) : (
          <div className="flex-1 bg-emerald-500/20 text-emerald-400 font-semibold py-3.5 rounded-xl text-sm text-center">
            Registrado ✓
          </div>
        )}
        {!cumple && !frozen && (
          <button onClick={handleReport} className="px-5 bg-white/5 text-white text-sm rounded-xl border border-white/10">
            {reported ? 'Enviado' : 'Reportar'}
          </button>
        )}
      </div>
    </div>
  )
}

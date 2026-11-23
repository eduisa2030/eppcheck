import { useEffect, useRef, useState } from 'react'
import { saveScan as saveLocal } from '../lib/storage'
import { saveScan as saveRemote } from '../lib/api'
import { vibrate, playBeep } from '../lib/feedback'
import { ITEM_CLASSES, ITEMS } from '../lib/models'
import { hasModel } from '../lib/config'
import { complianceFromResults, snapshotResults, startDetection } from '../lib/detect'
import { useCamera } from '../lib/useCamera'
import CameraSwitchButton from '../components/CameraSwitchButton'

export default function Scan({ onBack, user }) {
  const videoRef = useRef(null)
  const frozenRef = useRef(false)
  const [results, setResults] = useState({})
  const [frozen, setFrozen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reported, setReported] = useState(false)
  const [showNotifyAsk, setShowNotifyAsk] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelMessage, setModelMessage] = useState('Cargando modelos de detección…')
  const prevCumple = useRef(null)
  const operator = user?.name || user?.user || 'Operador'
  const { mirrored, canSwitch, switching, error: cameraError, switchCamera } = useCamera(videoRef)
  const { cumple, missing: problemas, analyzing } = complianceFromResults(results)
  const criticos = problemas.filter(i => i === 'casco' || i === 'chaleco')
  const pending = analyzing || Boolean(cameraError) || Boolean(modelError)

  useEffect(() => {
    return startDetection({
      videoRef,
      onResults: setResults,
      onModelError: setModelError,
      onMessage: setModelMessage,
      isFrozen: () => frozenRef.current,
    })
  }, [])

  useEffect(() => {
    if (prevCumple.current !== null && prevCumple.current !== cumple && !analyzing && !frozen) {
      vibrate(cumple ? 40 : [30, 40, 30])
      playBeep(cumple)
    }
    prevCumple.current = cumple
  }, [cumple, analyzing, frozen])

  const confirmResult = async () => {
    if (pending) return
    frozenRef.current = true
    setFrozen(true)
    const details = snapshotResults(results)
    const data = {
      cumple,
      missing: problemas,
      details,
      user: operator,
      timestamp: new Date().toISOString()
    }
    saveLocal(data)
    await saveRemote(data)
    setSaved(true)
    setShowNotifyAsk(true)
  }

  const sendNotification = async () => {
    const details = snapshotResults(results)
    const data = {
      user: operator,
      timestamp: new Date().toISOString(),
      results: details,
      details,
      cumple,
      missing: problemas
    }
    try {
      await fetch('https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=notify', {
        method: 'POST',
        body: JSON.stringify(data)
      })
    } catch (e) {}
    setShowNotifyAsk(false)
  }

  const handleReport = async () => {
    const details = snapshotResults(results)
    const data = { 
      user: operator, 
      timestamp: new Date().toISOString(), 
      results: details, 
      details,
      message: 'El operador considera que la detección puede ser incorrecta'
    }
    saveLocal({ cumple: false, missing: ['REPORTE'], details, user: operator })
    try {
      await fetch('https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=notify', {
        method: 'POST',
        body: JSON.stringify(data)
      })
    } catch (e) {}
    setReported(true)
  }

  const badge = s => s === 'bien' ? 'bg-emerald-500' : s === 'mal' ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col">
      <div className="relative mx-5 mt-5 rounded-3xl overflow-hidden bg-black" style={{height:'36vh'}}>
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${mirrored ? '-scale-x-100' : ''}`} />
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2.5 py-1 rounded-full text-[11px]">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> EN VIVO
        </div>
        <button onClick={onBack} className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur rounded-full flex items-center justify-center">✕</button>
        {canSwitch && <CameraSwitchButton onClick={switchCamera} disabled={switching} />}
        {cameraError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center text-sm">
            {cameraError}
          </div>
        )}
      </div>

      {/* Resultado principal */}
      <div className="px-5 mt-4">
        <div className={`rounded-2xl py-4 text-center ${pending ? 'bg-white/5 border border-white/10' : cumple ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-red-500/15 border border-red-500/30'}`}>
          <p className={`text-lg font-bold ${pending ? 'text-[#C8C8D0]' : cumple ? 'text-emerald-400' : 'text-red-400'}`}>
            {cameraError ? 'CÁMARA NO DISPONIBLE' : modelError ? 'MODELOS NO DISPONIBLES' : pending ? 'ANALIZANDO' : cumple ? 'AUTORIZADO PARA CHECAR' : 'NO AUTORIZADO'}
          </p>
          <p className="text-xs mt-1 text-[#C8C8D0]">
            {cameraError || modelError || (pending ? (modelMessage || 'Cargando modelos de detección…') : cumple ? 'EPP completo' : 'Completa tu equipo antes de checar')}
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
            if (!hasModel(item)) {
              return (
                <div key={item} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/10 text-[#8A8A98]">–</div>
                  <span className="capitalize flex-1 text-sm">{item}</span>
                  <span className="text-xs text-[#C8C8D0]">Sin modelo aún</span>
                  <span className="text-[11px] w-8 text-right text-[#8A8A98]">—</span>
                </div>
              )
            }
            const r = results[item]
            if (!r) {
              return (
                <div key={item} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/10 text-[#8A8A98]">…</div>
                  <span className="capitalize flex-1 text-sm">{item}</span>
                  <span className="text-xs text-[#C8C8D0]">Cargando…</span>
                  <span className="text-[11px] w-8 text-right text-[#8A8A98]">—</span>
                </div>
              )
            }
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
          <button onClick={confirmResult} disabled={pending} className="flex-1 bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50">
            Confirmar resultado
          </button>
        ) : (
          <div className="flex-1 bg-emerald-500/20 text-emerald-400 font-semibold py-3.5 rounded-xl text-sm text-center">
            Registrado ✓
          </div>
        )}
        {!pending && !cumple && !frozen && (
          <button onClick={handleReport} className="px-5 bg-white/5 text-white text-sm rounded-xl border border-white/10">
            {reported ? 'Enviado' : 'Reportar'}
          </button>
        )}
      </div>

      {showNotifyAsk && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-[100] p-4">
          <div className="bg-[#15151F] rounded-3xl p-6 w-full max-w-sm border border-white/10">
            <p className="text-center font-semibold mb-1">Resultado registrado</p>
            <p className="text-center text-sm text-[#8A8A98] mb-5">¿Quieres enviar notificación al supervisor?</p>
            <div className="flex gap-2">
              <button onClick={() => setShowNotifyAsk(false)} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm">
                Cerrar
              </button>
              <button onClick={sendNotification} className="flex-1 py-3 rounded-xl bg-[#FFC21A] text-black font-semibold text-sm">
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { saveScan as saveLocal, savePledge } from '../lib/storage'
import { saveScan as saveRemote } from '../lib/api'
import { vibrate, playBeep } from '../lib/feedback'
import { ITEM_CLASSES, ITEMS } from '../lib/models'
import { activeModelIds, hasActiveModel, modelStatusText, subscribeModelProgress } from '../lib/modelCache'
import { startDetection } from '../lib/detect'
import {
  PLEDGE_TEXT,
  acceptPledge,
  activeScanItems,
  capturePhoto,
  captureStep,
  currentItem,
  initialScan,
  reduceScan,
  scanResult,
  stepPrompt,
  stepTitle,
} from '../lib/scanFlow'
import { captureVideoFrame } from '../lib/camera'
import { SMOOTHING } from '../lib/config'
import { useCamera } from '../lib/useCamera'
import CameraSwitchButton from '../components/CameraSwitchButton'

const NOTIFY_URL = 'https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=notify'

function confidenceColor(pBien, threshold = SMOOTHING.onThreshold) {
  const t = Math.max(0, Math.min(1, Number(pBien) / threshold))
  const from = t < 0.5 ? [248, 113, 113] : [251, 191, 36]
  const to = t < 0.5 ? [251, 191, 36] : [52, 211, 153]
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2
  const rgb = from.map((channel, i) => Math.round(channel + (to[i] - channel) * u))
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

export default function Scan({ onBack, user }) {
  const videoRef = useRef(null)
  const sessionRef = useRef(null)
  const savingRef = useRef(false)
  const savedPayload = useRef(null)
  const [flow, setFlow] = useState(() => initialScan(activeModelIds(), Date.now()))
  const flowRef = useRef(flow)
  const [reported, setReported] = useState(false)
  const [showNotifyAsk, setShowNotifyAsk] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelProgress, setModelProgress] = useState({ ready: false, itemsReady: {} })
  const operator = user?.name || user?.user || 'Operador'
  const { mirrored, canSwitch, switching, error: cameraError, ready: cameraReady, switchCamera } = useCamera(videoRef)

  const update = next => {
    flowRef.current = next
    setFlow(next)
  }

  const restart = () => {
    update(initialScan(activeModelIds(), Date.now()))
    ITEMS.forEach(id => sessionRef.current?.resetItem(id))
    savingRef.current = false
    savedPayload.current = null
    setReported(false)
    setShowNotifyAsk(false)
  }

  useEffect(() => subscribeModelProgress(setModelProgress), [])

  useEffect(() => {
    const session = startDetection({
      videoRef,
      onModelError: setModelError,
      isFrozen: () => flowRef.current?.phase !== 'step',
      activeItems: () => activeScanItems(flowRef.current),
      onFrame: predictions => {
        const before = flowRef.current
        const { state, resetIds } = reduceScan(before, { predictions, now: Date.now() })
        resetIds.forEach(id => session.resetItem(id))
        if (state.index !== before.index) {
          vibrate(40)
          playBeep(true)
        }
        update(state)
      },
    })
    sessionRef.current = session
    return () => session.stop()
  }, [])

  useEffect(() => {
    if (flow.phase !== 'done' || savingRef.current) return
    savingRef.current = true
    const { details, missing, cumple } = scanResult(flow)
    const data = {
      cumple,
      missing,
      details,
      user: operator,
      timestamp: new Date().toISOString(),
      declaracion: flow.pledge,
      fotoEvidencia: Boolean(flow.photo),
    }
    savedPayload.current = { ...data, results: details }
    saveLocal({ ...data, foto: flow.photo?.small || null })
    saveRemote(data)
    setShowNotifyAsk(true)
    vibrate(cumple ? 40 : [30, 40, 30])
    playBeep(cumple)
  }, [flow, operator])

  const handleAccept = () => {
    const next = acceptPledge(flowRef.current, operator, Date.now())
    savePledge(next.pledge)
    update(next)
  }

  const handleCapture = () => {
    const current = flowRef.current
    if (current.phase === 'step') {
      const id = currentItem(current)
      const next = captureStep(current, Date.now())
      if (id) sessionRef.current?.resetItem(id)
      update(next)
      return
    }
    if (current.phase === 'photo') {
      const full = captureVideoFrame(videoRef.current, { mirrored })
      const small = captureVideoFrame(videoRef.current, { mirrored, maxSize: 480, quality: 0.7 })
      update(capturePhoto(current, full ? { full, small } : null))
    }
  }

  const sendNotification = async () => {
    const payload = savedPayload.current
    if (payload) {
      try {
        await fetch(NOTIFY_URL, { method: 'POST', body: JSON.stringify(payload) })
      } catch {}
    }
    setShowNotifyAsk(false)
  }

  const handleReport = async () => {
    const payload = savedPayload.current
    const details = payload?.details || {}
    const data = {
      user: operator,
      timestamp: new Date().toISOString(),
      results: details,
      details,
      message: 'El operador considera que la detección puede ser incorrecta',
    }
    saveLocal({ cumple: false, missing: ['REPORTE'], details, user: operator })
    try {
      await fetch(NOTIFY_URL, { method: 'POST', body: JSON.stringify(data) })
    } catch {}
    setReported(true)
  }

  const finished = flow.phase === 'done'
  const result = finished ? scanResult(flow) : null
  const cumple = result?.cumple ?? false
  const currentId = currentItem(flow)
  const itemReady = currentId ? Boolean(modelProgress.itemsReady?.[currentId]) : true
  const badge = s => s === 'bien' ? 'bg-emerald-500' : s === 'mal' ? 'bg-amber-500' : s === 'no_detectado' ? 'bg-white/10' : 'bg-red-500'
  const labelFor = (id, status) => status === 'no_detectado'
    ? 'No detectado'
    : (ITEM_CLASSES[id]?.[status] || status)

  let headline = 'ESCANEO'
  let subtitle = ''
  let tone = 'neutral'
  if (cameraError) {
    headline = 'CÁMARA NO DISPONIBLE'
    subtitle = cameraError
  } else if (modelError) {
    headline = 'MODELOS NO DISPONIBLES'
    subtitle = modelError
  } else if (finished) {
    headline = cumple ? 'AUTORIZADO PARA CHECAR' : 'NO AUTORIZADO'
    subtitle = cumple
      ? 'EPP completo'
      : `Faltó: ${result.missing.map(id => `${id} (${labelFor(id, result.details[id].status).toLowerCase()})`).join(', ')}`
    tone = cumple ? 'ok' : 'bad'
  } else if (flow.phase === 'photo') {
    headline = 'FOTO DE CUERPO COMPLETO'
    subtitle = 'Aléjate para que se vea todo tu equipo y presiona Capturar'
  } else if (flow.phase === 'step') {
    const live = flow.live[currentId]
    headline = currentId.toUpperCase()
    if (!itemReady) subtitle = modelStatusText(modelProgress) || 'Preparando el modelo…'
    else if (!cameraReady) subtitle = 'Abriendo la cámara…'
    else if (live?.status === 'bien') {
      subtitle = 'Bien, quédate así un momento…'
      tone = 'ok'
    } else subtitle = `${stepPrompt(currentId)}. Se valida sola al detectarla, o presiona Capturar.`
  }

  const toneClass = tone === 'ok'
    ? 'bg-emerald-500/15 border border-emerald-500/30'
    : tone === 'bad'
      ? 'bg-red-500/15 border border-red-500/30'
      : 'bg-white/5 border border-white/10'
  const titleClass = tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-[#C8C8D0]'
  const shownPhoto = finished ? flow.photo?.full : null

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col pb-40">
      <div className="relative mx-5 mt-5 rounded-3xl overflow-hidden bg-black" style={{ height: '36vh' }}>
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${mirrored ? '-scale-x-100' : ''} ${shownPhoto ? 'invisible' : ''}`} />
        {shownPhoto && (
          <img src={shownPhoto} alt="Foto de evidencia" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2.5 py-1 rounded-full text-[11px]">
          {shownPhoto
            ? <><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> EVIDENCIA</>
            : <><span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> EN VIVO</>}
        </div>
        <button onClick={onBack} className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur rounded-full flex items-center justify-center">✕</button>
        {canSwitch && !finished && <CameraSwitchButton onClick={switchCamera} disabled={switching} />}
        {cameraError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center text-sm">
            {cameraError}
          </div>
        )}
      </div>

      {flow.phase !== 'pledge' && (
        <div className="px-5 mt-4">
          <div className={`rounded-2xl py-4 px-4 text-center ${toneClass}`}>
            {stepTitle(flow) && !cameraError && !modelError && (
              <p className="text-[10px] tracking-widest text-[#8A8A98] mb-1 uppercase">{stepTitle(flow)}</p>
            )}
            <p className={`text-lg font-bold ${titleClass}`}>{headline}</p>
            {subtitle && <p className="text-xs mt-1 text-[#C8C8D0]">{subtitle}</p>}
          </div>
        </div>
      )}

      {flow.phase !== 'pledge' && (
        <div className="mx-5 mt-3 bg-[#12121A] rounded-2xl p-4 border border-white/5">
          <p className="text-[10px] tracking-widest text-[#6E6E7C] mb-3">LISTA · {operator}</p>
          <div className="space-y-2.5">
            {ITEMS.map(item => {
              if (!hasActiveModel(item)) {
                return (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/10 text-[#8A8A98]">–</div>
                    <span className="capitalize flex-1 text-sm">{item}</span>
                    <span className="text-xs text-[#C8C8D0]">Sin modelo aún</span>
                  </div>
                )
              }
              const final = flow.final[item]
              const isCurrent = currentId === item
              const live = isCurrent ? flow.live[item] : null
              const status = final?.status || live?.status
              const label = final
                ? labelFor(item, final.status)
                : isCurrent
                  ? (status ? labelFor(item, status) : (itemReady ? 'Buscando…' : 'Preparando…'))
                  : 'Pendiente'
              const mark = final?.locked ? '✓' : final?.status === 'no_detectado' ? '?' : final ? '!' : isCurrent ? '…' : '·'
              const markClass = !final
                ? (isCurrent ? 'bg-[#FFC21A] text-black' : 'bg-white/10 text-[#8A8A98]')
                : final.status === 'no_detectado' ? 'bg-white/10 text-[#8A8A98]' : `text-black ${badge(final.status)}`
              const pBien = live?.pBien
              const showBar = isCurrent && pBien != null
              const bienPct = showBar ? Math.round(Math.max(0, Math.min(1, pBien)) * 100) : null
              const barColor = showBar ? confidenceColor(pBien) : null
              return (
                <div key={item}>
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${markClass}`}>{mark}</div>
                    <span className={`capitalize flex-1 text-sm ${isCurrent ? 'font-semibold' : ''}`}>{item}</span>
                    <span className="text-xs text-[#C8C8D0]">{label}</span>
                    <span className="text-[11px] w-14 text-right text-[#8A8A98] tabular-nums whitespace-nowrap">
                      {final?.hora || (final ? '' : '—')}
                    </span>
                  </div>
                  {showBar && (
                    <div className="mt-1.5 ml-8">
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${bienPct}%`, backgroundColor: barColor, transition: 'width 200ms linear, background-color 200ms linear' }}
                        />
                      </div>
                      <div className="flex justify-between gap-2 mt-1">
                        <span className="text-[11px] text-[#C8C8D0] truncate">Confianza de «{ITEM_CLASSES[item]?.bien || 'bien'}»</span>
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: barColor }}>{bienPct}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {hasActiveModel('casco') && (
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${flow.photo ? 'bg-emerald-500 text-black' : flow.phase === 'photo' ? 'bg-[#FFC21A] text-black' : 'bg-white/10 text-[#8A8A98]'}`}>
                  {flow.photo ? '✓' : flow.phase === 'photo' ? '…' : '·'}
                </div>
                <span className={`flex-1 text-sm ${flow.phase === 'photo' ? 'font-semibold' : ''}`}>Foto de cuerpo completo</span>
                <span className="text-xs text-[#C8C8D0]">{flow.photo ? 'Guardada' : flow.phase === 'photo' ? 'Ahora' : 'Pendiente'}</span>
              </div>
            )}
          </div>
          {flow.pledge && (
            <p className="text-[10px] text-[#6E6E7C] mt-3">Declaración aceptada · {flow.pledge.fecha} {flow.pledge.hora}</p>
          )}
        </div>
      )}

      {(flow.phase === 'step' || flow.phase === 'photo') && !cameraError && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto px-5 pt-3 pb-5 flex flex-col gap-2 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F] to-[#0A0A0F]/80 z-40">
          <button
            type="button"
            onClick={handleCapture}
            className="w-full bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-5 rounded-2xl text-lg"
          >
            {flow.phase === 'photo' ? 'Capturar foto' : 'Capturar'}
          </button>
          <button type="button" onClick={restart} className="w-full bg-white/5 text-white text-sm py-2.5 rounded-xl border border-white/10">
            Reiniciar escaneo
          </button>
        </div>
      )}

      {finished && (
        <div className="px-5 pt-4 pb-8 flex flex-col gap-2">
          <div className="bg-emerald-500/20 text-emerald-400 font-semibold py-3.5 rounded-xl text-sm text-center">Registrado ✓</div>
          <button type="button" onClick={restart} className="w-full bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-3.5 rounded-xl text-sm">
            Reiniciar escaneo
          </button>
          {!cumple && (
            <button onClick={handleReport} className="w-full bg-white/5 text-white text-sm py-3.5 rounded-xl border border-white/10">
              {reported ? 'Enviado' : 'Reportar'}
            </button>
          )}
        </div>
      )}

      {flow.phase === 'pledge' && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-[100] p-4">
          <div className="bg-[#15151F] rounded-3xl p-6 w-full max-w-sm border border-white/10">
            <p className="text-[10px] tracking-widest text-[#FFC21A] text-center mb-2">DECLARACIÓN OBLIGATORIA</p>
            <p className="text-center text-base font-semibold leading-snug mb-4">{PLEDGE_TEXT}</p>
            <p className="text-center text-xs text-[#8A8A98] mb-5">Se registra con tu nombre ({operator}), la fecha y la hora.</p>
            <button onClick={handleAccept} className="w-full py-4 rounded-xl bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-bold text-base">
              Acepto
            </button>
            <button onClick={onBack} className="w-full mt-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

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

import { useEffect, useRef, useState } from 'react'
import { saveScan as saveLocal } from '../lib/storage'
import { saveScan as saveRemote } from '../lib/api'
import { vibrate, playBeep } from '../lib/feedback'
import { ITEM_CLASSES, ITEMS } from '../lib/models'
import { activeModelIds, hasActiveModel, subscribeModelProgress } from '../lib/modelCache'
import { complianceFromResults, modeledItems, snapshotResults, startDetection } from '../lib/detect'
import { activeScanItems, armScan, captureShot, hasNextShot, initialScan, isScanValidated, reduceScan, shotTitle, stepPrompt } from '../lib/scanFlow'
import { captureVideoFrame } from '../lib/camera'
import { SMOOTHING } from '../lib/config'
import { useCamera } from '../lib/useCamera'
import CameraSwitchButton from '../components/CameraSwitchButton'

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
  const prevLocks = useRef(0)
  const [flow, setFlow] = useState(() => initialScan(modeledItems(), Date.now()))
  const flowRef = useRef(flow)
  const [reported, setReported] = useState(false)
  const [showNotifyAsk, setShowNotifyAsk] = useState(false)
  const [capturedPhoto, setCapturedPhoto] = useState(null)
  const [modelError, setModelError] = useState('')
  const [modelProgress, setModelProgress] = useState({ loaded: 0, total: 0, ready: false })
  const operator = user?.name || user?.user || 'Operador'
  const { mirrored, canSwitch, switching, error: cameraError, ready: cameraReady, switchCamera } = useCamera(videoRef)
  const modelsReadyRef = useRef(false)
  const cameraReadyRef = useRef(false)

  const restart = () => {
    const next = initialScan(modeledItems(), Date.now())
    next.items.forEach(id => sessionRef.current?.resetItem(id))
    flowRef.current = next
    setFlow(next)
    savingRef.current = false
    savedPayload.current = null
    prevLocks.current = 0
    setReported(false)
    setShowNotifyAsk(false)
    setCapturedPhoto(null)
  }

  useEffect(() => subscribeModelProgress(progress => {
    modelsReadyRef.current = progress.ready
    setModelProgress(progress)
    if (!progress.ready || flowRef.current?.clockStarted) return
    const items = activeModelIds()
    const current = flowRef.current
    const planned = initialScan(items, Date.now())
    if (!current || (current.allItems || current.items).join() === planned.allItems.join()) return
    const next = planned
    flowRef.current = next
    setFlow(next)
  }), [])

  useEffect(() => {
    cameraReadyRef.current = cameraReady
  }, [cameraReady])

  const shotReady = flow.shot === 'hands' ? !!modelProgress.handsReady : !!modelProgress.ready

  useEffect(() => {
    const current = flowRef.current
    const ready = current?.shot === 'hands' ? !!modelProgress.handsReady : !!modelProgress.ready
    if (!ready || !cameraReady || cameraError || modelError) return
    if (!current || current.clockStarted || current.phase === 'done' || current.phase === 'timeout') return
    const armed = armScan(current, Date.now())
    flowRef.current = armed
    setFlow(armed)
  }, [modelProgress.ready, modelProgress.handsReady, cameraReady, cameraError, modelError, flow.shot, flow.phase, flow.clockStarted])

  useEffect(() => {
    const session = startDetection({
      videoRef,
      onModelError: setModelError,
      isFrozen: () => {
        const phase = flowRef.current?.phase
        return phase === 'done' || phase === 'timeout'
      },
      activeItems: () => activeScanItems(flowRef.current),
      onFrame: (predictions) => {
        if (!modelsReadyRef.current || !cameraReadyRef.current) return
        const { state, resetIds } = reduceScan(flowRef.current, { predictions, now: Date.now() })
        resetIds.forEach(id => session.resetItem(id))
        flowRef.current = state
        setFlow(state)
      },
    })
    sessionRef.current = session
    return () => session.stop()
  }, [])

  useEffect(() => {
    const locks = Object.keys(flow.locked).length
    if (locks > prevLocks.current) {
      vibrate(40)
      playBeep(true)
    }
    prevLocks.current = locks
  }, [flow.locked])

  useEffect(() => {
    if (flow.phase !== 'done' || savingRef.current) return
    savingRef.current = true
    const view = {}
    const tracked = flow.allItems || flow.items
    for (const id of tracked) {
      const row = flow.final[id]
      view[id] = { status: row?.status || 'no_detectado', conf: row?.conf ?? 0 }
    }
    const judged = complianceFromResults(view)
    const details = snapshotResults(view)
    const data = {
      cumple: judged.cumple,
      missing: judged.missing,
      details,
      user: operator,
      timestamp: new Date().toISOString(),
    }
    savedPayload.current = { ...data, results: details }
    saveLocal(data)
    saveRemote(data)
    setShowNotifyAsk(true)
    vibrate(judged.cumple ? 40 : [30, 40, 30])
    playBeep(judged.cumple)
  }, [flow, operator])

  const handleCapture = () => {
    const current = flowRef.current
    if (!current || current.phase === 'done' || current.phase === 'timeout') return
    const photo = captureVideoFrame(videoRef.current, { mirrored })
    const next = captureShot(current, photo, Date.now())
    if (next.phase === 'done') {
      setCapturedPhoto(photo)
    } else {
      setCapturedPhoto(null)
      next.items.forEach(id => sessionRef.current?.resetItem(id))
    }
    flowRef.current = next
    setFlow(next)
  }

  const finished = flow.phase === 'done'
  const timedOut = flow.phase === 'timeout'
  const finalView = {}
  if (finished) {
    for (const id of (flow.allItems || flow.items)) {
      const row = flow.final[id]
      finalView[id] = { status: row?.status || 'no_detectado', conf: row?.conf ?? 0 }
    }
  }
  const judged = finished ? complianceFromResults(finalView) : null
  const cumple = judged?.cumple ?? false
  const problemas = judged?.missing ?? []
  const criticos = problemas.filter(i => i === 'casco' || i === 'chaleco')
  const currentId = flow.items[flow.index]
  const scanArmed = shotReady && cameraReady && !cameraError && !modelError
  const loadingModels = !scanArmed && !cameraError && !modelError && !finished && !timedOut

  const sendNotification = async () => {
    const payload = savedPayload.current
    if (!payload) {
      setShowNotifyAsk(false)
      return
    }
    try {
      await fetch('https://script.google.com/macros/s/AKfycbz3WNpFqyN9iO65f9ba9B9jqzE-wSVaW0bH9y7rWBckkS2PcCkjOOQb4rjN4fGIvb7pvQ/exec?action=notify', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    } catch (e) {}
    setShowNotifyAsk(false)
  }

  const handleReport = async () => {
    const payload = savedPayload.current
    const details = payload?.details || snapshotResults({})
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

  const badge = s => s === 'bien' ? 'bg-emerald-500' : s === 'mal' ? 'bg-amber-500' : s === 'no_detectado' ? 'bg-white/10' : 'bg-red-500'
  const phaseLabel = phase => ({
    descargando: 'descargando',
    descargado: 'descargado',
    memoria: 'descargado',
    preparando: 'preparando GPU',
    calentando: 'preparando GPU',
    listo: 'listo',
    cache: 'listo · caché',
  })[phase] || phase

  let headline = 'ESCANEO'
  let subtitle = currentId ? stepPrompt(currentId) : ''
  let tone = 'neutral'
  if (cameraError) {
    headline = 'CÁMARA NO DISPONIBLE'
    subtitle = cameraError
  } else if (modelError) {
    headline = 'MODELOS NO DISPONIBLES'
    subtitle = modelError
  } else if (timedOut) {
    headline = 'TIEMPO AGOTADO'
    subtitle = flow.notice
  } else if (finished) {
    headline = cumple ? 'AUTORIZADO PARA CHECAR' : 'NO AUTORIZADO'
    subtitle = cumple ? 'EPP completo' : 'Completa tu equipo antes de checar'
    tone = cumple ? 'ok' : 'bad'
  } else if (loadingModels) {
    headline = 'CARGANDO'
    subtitle = flow.shot === 'hands' && !modelProgress.handsReady
      ? 'Preparando modelo de guantes…'
      : (!modelProgress.ready
        ? (modelProgress.stage === 'gpu'
          ? `Preparando en el teléfono… ${modelProgress.warmed || 0}/${modelProgress.total}`
          : (modelProgress.total
            ? `Cargando modelos… ${modelProgress.loaded}/${modelProgress.total}`
            : 'Cargando modelos…'))
        : 'Preparando cámara…')
  } else if (flow.phase === 'ready') {
    if (isScanValidated(flow)) {
      headline = 'VALIDADO'
      subtitle = hasNextShot(flow)
        ? 'Presiona Capturar y seguir, o espera a validar'
        : 'Presiona Capturar para registrar'
      tone = 'ok'
    } else {
      headline = 'MANTÉN EL EQUIPO'
      subtitle = flow.shot === 'hands'
        ? 'Se perdió la validación. Acerca otra vez las manos a la cámara.'
        : 'Se perdió la validación. Acércate de nuevo a la cámara.'
      tone = 'bad'
    }
  } else if (flow.phase === 'verify') {
    headline = 'VERIFICANDO'
    subtitle = flow.notice
  } else {
    headline = currentId ? stepPrompt(currentId, flow.shot) : 'ESCANEO'
    subtitle = flow.notice || (flow.shot === 'hands' ? 'Acerca tus manos con guantes a la cámara' : 'Quédate frente a la cámara')
  }

  const toneClass = tone === 'ok'
    ? 'bg-emerald-500/15 border border-emerald-500/30'
    : tone === 'bad'
      ? 'bg-red-500/15 border border-red-500/30'
      : 'bg-white/5 border border-white/10'
  const titleClass = tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-[#C8C8D0]'

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col pb-28">
      <div className="relative mx-5 mt-5 rounded-3xl overflow-hidden bg-black" style={{height:'36vh'}}>
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${mirrored ? '-scale-x-100' : ''} ${capturedPhoto ? 'invisible' : ''}`} />
        {capturedPhoto && (
          <img src={capturedPhoto} alt="Captura del escaneo" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2.5 py-1 rounded-full text-[11px]">
          {capturedPhoto
            ? <><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> CAPTURADO</>
            : <><span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> EN VIVO</>}
        </div>
        <button onClick={onBack} className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur rounded-full flex items-center justify-center">✕</button>
        {canSwitch && <CameraSwitchButton onClick={switchCamera} disabled={switching} />}
        {cameraError && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 text-center text-sm">
            {cameraError}
          </div>
        )}
      </div>

      <div className="px-5 mt-4">
        <div className={`rounded-2xl py-4 px-4 text-center ${toneClass}`}>
          {shotTitle(flow) && !finished && !timedOut && !cameraError && !modelError && (
            <p className="text-[10px] tracking-widest text-[#8A8A98] mb-1">{shotTitle(flow)}</p>
          )}
          <p className={`text-lg font-bold ${titleClass}`}>{headline}</p>
          <p className="text-xs mt-1 text-[#C8C8D0]">{subtitle}</p>
          {loadingModels && Object.keys(modelProgress.models || {}).length > 0 && (
            <ul className="mt-3 space-y-1 text-left text-[11px] text-[#C8C8D0]">
              {Object.entries(modelProgress.models).map(([id, item]) => (
                <li key={id} className="flex justify-between gap-3 capitalize">
                  <span>{id}</span>
                  <span>{phaseLabel(item.phase)}{item.source === 'idb' ? ' · caché' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {finished && criticos.length > 0 && (
          <p className="text-center text-xs text-red-400 mt-2 font-medium">Falta crítico: {criticos.join(', ')}</p>
        )}
      </div>

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
                  <span className="text-[11px] w-8 text-right text-[#8A8A98]">—</span>
                </div>
              )
            }
            const final = flow.final[item]
            const inCurrentShot = flow.items.includes(item)
            const isCurrent = flow.phase === 'step' && currentId === item
            const watching = inCurrentShot && (isCurrent || flow.phase === 'verify' || flow.phase === 'ready')
            const live = watching ? flow.live[item] : null
            const status = final?.status || live?.status
            const conf = final?.conf ?? live?.conf
            const label = status === 'no_detectado'
              ? 'No detectado'
              : status
                ? (ITEM_CLASSES[item]?.[status] || status)
                : isCurrent ? 'Buscando…' : 'Pendiente'
            const mark = final?.locked || status === 'bien' ? '✓' : status === 'no_detectado' ? '?' : status ? '!' : isCurrent ? '…' : '·'
            const markClass = !status || status === 'no_detectado'
              ? 'bg-white/10 text-[#8A8A98]'
              : `text-black ${badge(status)}`
            const pBien = live?.pBien
            const showBar = watching && !finished && !timedOut && pBien != null
            const bienPct = showBar ? Math.round(Math.max(0, Math.min(1, pBien)) * 100) : null
            const barColor = showBar ? confidenceColor(pBien) : null
            return (
              <div key={item}>
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${markClass}`}>
                    {mark}
                  </div>
                  <span className="capitalize flex-1 text-sm">{item}</span>
                  <span className="text-xs text-[#C8C8D0]">{label}</span>
                  <span className="text-[11px] w-8 text-right text-[#8A8A98]">{conf == null || status === 'no_detectado' ? '—' : `${Math.round(conf * 100)}%`}</span>
                </div>
                {showBar && (
                  <div className="mt-1.5 ml-8">
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${bienPct}%`,
                          backgroundColor: barColor,
                          transition: 'width 200ms linear, background-color 200ms linear',
                        }}
                      />
                    </div>
                    <div className="flex justify-between gap-2 mt-1">
                      <span className="text-[11px] text-[#C8C8D0] truncate">{status ? label : 'Analizando…'}</span>
                      <span className="text-[11px] font-semibold tabular-nums" style={{ color: barColor }}>{bienPct}%</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!finished && !timedOut && !loadingModels && !cameraError && !modelError && (
        <div className="px-5 pt-4 pb-8 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleCapture}
            className="w-full bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-5 rounded-2xl text-lg"
          >
            {hasNextShot(flow) ? 'Capturar y seguir' : 'Capturar'}
          </button>
          <button type="button" onClick={restart} className="w-full bg-white/5 text-white text-sm py-3.5 rounded-xl border border-white/10">
            Reiniciar escaneo
          </button>
        </div>
      )}

      {(finished || timedOut) && (
        <div className="px-5 pt-4 pb-8 flex flex-col gap-2">
          {finished && (
            <div className="bg-emerald-500/20 text-emerald-400 font-semibold py-3.5 rounded-xl text-sm text-center">
              Registrado ✓
            </div>
          )}
          <button type="button" onClick={restart} className="w-full bg-gradient-to-b from-[#FFE07A] to-[#FFC21A] text-black font-semibold py-3.5 rounded-xl text-sm">
            Reiniciar escaneo
          </button>
          {finished && !cumple && (
            <button onClick={handleReport} className="w-full bg-white/5 text-white text-sm py-3.5 rounded-xl border border-white/10">
              {reported ? 'Enviado' : 'Reportar'}
            </button>
          )}
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

import { ITEMS } from './models'
import { MODELS, SMOOTHING, hasModel } from './config'
import { loadModel } from './tm'

const modelCache = {}
let loadPromise = null

/**
 * Normaliza las etiquetas de metadata.json a bien | mal | sin.
 * Casco: "Bien puesto", "mal puesto", "sin poner " (mayúsculas y espacios distintos).
 * Chaleco: "Bien puesto", "Mal puesto", "Sin poner " (solo "Sin poner " lleva espacio final).
 * "puesto" a secas significa "bien puesto".
 * Lentes (modelo actual): "LENTES" es bien/puesto y "NO PUESTO" es sin.
 * "NO PUESTO" contiene el texto "puesto", así que se resuelve antes
 * de esa búsqueda. Lentes anteriores ("LENTES BIEN", "LENTES MAL", "NADA")
 * siguen valiendo: NADA es "sin poner".
 */
export function mapLabel(label) {
  const n = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (n.includes('no puesto')) return 'sin'
  if (n.includes('mal')) return 'mal'
  if (n.includes('sin') || n.includes('nada')) return 'sin'
  if (n === 'lentes' || n.includes('bien') || n.includes('puesto')) return 'bien'
  return 'sin'
}

function mean(values) {
  if (!values.length) return 0
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

export function probsFromPredictions(predictions) {
  const probs = { bien: 0, mal: 0, sin: 0 }
  for (const pred of predictions || []) {
    const key = mapLabel(pred.className)
    const probability = Number(pred.probability) || 0
    probs[key] = Math.max(probs[key], probability)
  }
  return probs
}

/**
 * Ventana móvil + histéresis.
 * Entra a "bien" (puesto) solo si el promedio de p(bien) >= 0.75
 * y sale solo si ese promedio baja a <= 0.40.
 */
export function applySmoothing(state, probs, now, smooth = SMOOTHING) {
  state.history.push({
    t: now,
    bien: probs.bien,
    mal: probs.mal,
    sin: probs.sin,
  })
  const cutoff = now - smooth.windowMs
  state.history = state.history.filter(sample => sample.t >= cutoff)

  const avgBien = mean(state.history.map(sample => sample.bien))
  const avgMal = mean(state.history.map(sample => sample.mal))
  const avgSin = mean(state.history.map(sample => sample.sin))

  let status = state.status
  if (status === 'bien') {
    if (avgBien <= smooth.offThreshold) {
      status = avgMal >= avgSin ? 'mal' : 'sin'
    }
  } else if (avgBien >= smooth.onThreshold) {
    status = 'bien'
  } else {
    const next = avgMal >= avgSin ? 'mal' : 'sin'
    if (status !== 'mal' && status !== 'sin') {
      status = next
    } else if (next !== status) {
      const winner = Math.max(avgMal, avgSin)
      const loser = Math.min(avgMal, avgSin)
      if (winner - loser >= (smooth.malSinMargin ?? 0.15)) status = next
    }
  }

  state.status = status
  state.conf = status === 'bien' ? avgBien : status === 'mal' ? avgMal : avgSin
  return state
}

export function modeledItems() {
  return ITEMS.filter(hasModel)
}

/** Cumplimiento solo con los elementos que tienen modelo. */
export function complianceFromResults(results) {
  const tracked = modeledItems()
  const analyzing = tracked.some(id => {
    const status = results?.[id]?.status
    return status !== 'bien' && status !== 'mal' && status !== 'sin'
  })
  const missing = tracked.filter(id => {
    const status = results?.[id]?.status
    return status === 'mal' || status === 'sin'
  })
  return {
    analyzing,
    missing,
    cumple: !analyzing && tracked.length > 0 && missing.length === 0,
  }
}

export function snapshotResults(results) {
  const details = { ...results }
  for (const id of ITEMS) {
    if (!hasModel(id)) {
      details[id] = { status: 'sin_modelo', conf: null, label: 'Sin modelo aún' }
    }
  }
  return details
}

function modelUrl(id) {
  return (MODELS[id] || '').trim()
}

function loadModels() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    for (const id of modeledItems()) {
      if (modelCache[id]) continue
      modelCache[id] = await loadModel(modelUrl(id))
    }
    return modelCache
  })().catch(err => {
    loadPromise = null
    throw err
  })
  return loadPromise
}

async function predictProbs(model, video) {
  const predictions = await model.predict(video)
  return probsFromPredictions(predictions)
}

/**
 * Abre la cámara, carga los modelos y predice cada ~200 ms.
 * Devuelve la función de limpieza del efecto.
 */
export function startDetection({ videoRef, onResults, onCameraError, onModelError, onMessage, isFrozen }) {
  let stream = null
  let timer = null
  let stopped = false
  let busy = false
  let warned = false
  const states = {}
  const smooth = SMOOTHING

  const emit = () => {
    const out = {}
    for (const id of modeledItems()) {
      const state = states[id]
      if (!state?.status) continue
      out[id] = {
        status: state.status,
        conf: +state.conf.toFixed(2),
      }
    }
    onResults(out)
  }

  const tick = async () => {
    if (stopped || isFrozen() || busy) return
    const video = videoRef?.current
    if (!video || video.readyState < 2 || !video.videoWidth) return
    busy = true
    try {
      const now = Date.now()
      for (const id of modeledItems()) {
        const model = modelCache[id]
        if (!model) continue
        if (!states[id]) states[id] = { history: [], status: null, conf: 0 }
        const probs = await predictProbs(model, video)
        if (stopped || isFrozen()) return
        applySmoothing(states[id], probs, now, smooth)
      }
      if (!stopped && !isFrozen()) emit()
    } catch (err) {
      if (!warned) {
        console.warn('Error al predecir EPP', err)
        warned = true
      }
    } finally {
      busy = false
    }
  }

  ;(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      if (stopped) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      const video = videoRef?.current
      if (video) {
        video.srcObject = stream
        video.play?.().catch(() => {})
      }
    } catch {
      if (!stopped) onCameraError('No se pudo acceder a la cámara. Revisa los permisos.')
      return
    }

    try {
      if (!stopped) onMessage('Cargando modelos de detección…')
      await loadModels()
      if (!stopped) onMessage('')
    } catch (err) {
      console.error(err)
      if (!stopped) onModelError('No se pudieron cargar los modelos de detección.')
      return
    }

    if (stopped) return
    timer = setInterval(tick, smooth.loopMs)
  })()

  return function cleanup() {
    stopped = true
    if (timer) clearInterval(timer)
    if (stream) stream.getTracks().forEach(track => track.stop())
  }
}

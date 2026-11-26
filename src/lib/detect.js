import { ITEMS } from './models'
import { CLASS_BIAS, SMOOTHING } from './config'
import { activeModelIds, getModel, hasActiveModel, preloadModels } from './modelCache'


/**
 * Normaliza las etiquetas de metadata.json a bien | mal | sin.
 * Casco (metadata): "Bien puesto", "mal puesto", "sin poner ".
 * "sin poner" contiene "sin" y se evalúa antes que "puesto", así que es sin.
 * Chaleco: "Bien puesto", "Mal puesto", "Sin poner " (solo "Sin poner " lleva espacio final).
 * "puesto" a secas significa "bien puesto".
 * Lentes (modelo actual): "LENTES" es bien/puesto y "NO PUESTO" es sin.
 * "NO PUESTO" contiene el texto "puesto", así que se resuelve antes
 * de esa búsqueda. Lentes anteriores ("LENTES BIEN", "LENTES MAL", "NADA")
 * siguen valiendo: NADA es "sin poner".
 * Guantes: "Con guantes" es bien, "Sin guantes" es sin, "Mal Puesto" es mal.
 */
export function mapLabel(label) {
  const n = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (n.includes('con guantes') || n === 'con guante') return 'bien'
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

export function rawProbsFromPredictions(predictions) {
  const probs = { bien: 0, mal: 0, sin: 0 }
  for (const pred of predictions || []) {
    const key = mapLabel(pred.className)
    const probability = Number(pred.probability) || 0
    probs[key] = Math.max(probs[key], probability)
  }
  return probs
}

/** El casco a veces puntúa "mal puesto" cuando no hay casco. Si sin está cerca, gana sin. */
export function preferSin(probs, bias = CLASS_BIAS) {
  const bien = probs.bien || 0
  const mal = probs.mal || 0
  const sin = probs.sin || 0
  const topIsMal = mal >= bien && mal >= sin
  if (topIsMal && sin >= bias.sinOverMal && bien < bias.bienMaxWhenPreferSin) {
    return { bien, mal: 0, sin: Math.max(sin, mal) }
  }
  return { bien, mal, sin }
}

export function probsFromPredictions(predictions, bias = CLASS_BIAS) {
  return preferSin(rawProbsFromPredictions(predictions), bias)
}

/**
 * Ventana móvil + histéresis.
 * Entra a "bien" (puesto) solo si el promedio de p(bien) >= 0.75
 * y sale solo si ese promedio baja a <= 0.40.
 */
export function applySmoothing(state, probs, now, smooth = SMOOTHING) {
  if (state.firstT == null) state.firstT = now
  state.history.push({
    t: now,
    bien: probs.bien,
    mal: probs.mal,
    sin: probs.sin,
  })
  const cutoff = now - smooth.windowMs
  state.history = state.history.filter(sample => sample.t >= cutoff)

  // Los primeros cuadros, antes de llenar la ventana, no fijan ni muestran estado.
  if (now - state.firstT < smooth.windowMs) {
    state.status = null
    state.conf = 0
    return state
  }

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
  return activeModelIds()
}

/** Cumplimiento solo con los elementos que tienen modelo. */
export function complianceFromResults(results) {
  const tracked = modeledItems()
  const analyzing = tracked.some(id => !results?.[id]?.status)
  const missing = tracked.filter(id => {
    const status = results?.[id]?.status
    return status && status !== 'bien'
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
    if (!hasActiveModel(id)) {
      details[id] = { status: 'sin_modelo', conf: null, label: 'Sin modelo aún' }
    }
  }
  return details
}

async function predictProbs(model, video) {
  const predictions = await model.predict(video)
  return probsFromPredictions(predictions)
}

/**
 * Carga los modelos y predice cada ~200 ms sobre el video ya abierto.
 * La cámara la maneja useCamera: al cambiar de lente solo se reemplaza
 * srcObject, este intervalo sigue siendo el único.
 */
export function startDetection({ videoRef, onResults, onFrame, onModelError, onMessage, isFrozen, activeItems }) {
  let timer = null
  let stopped = false
  let busy = false
  let warned = false
  const states = {}
  const smooth = SMOOTHING
  const listener = onFrame || onResults

  const tick = async () => {
    if (stopped || isFrozen?.() || busy) return
    const video = videoRef?.current
    if (!video || !video.srcObject || video.readyState < 2 || !video.videoWidth) return
    const ids = (activeItems ? activeItems() : modeledItems()).filter(id => getModel(id))
    if (!ids.length) return
    busy = true
    try {
      const now = Date.now()
      const out = {}
      for (const id of ids) {
        if (!states[id]) states[id] = { history: [], status: null, conf: 0 }
        const probs = await predictProbs(getModel(id), video)
        if (stopped || isFrozen?.()) return
        applySmoothing(states[id], probs, now, smooth)
        if (!states[id].status) continue
        out[id] = {
          status: states[id].status,
          conf: +states[id].conf.toFixed(2),
        }
      }
      if (!stopped && !isFrozen?.() && listener && Object.keys(out).length) listener(out)
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
      await preloadModels()
      if (!stopped) onMessage?.('')
    } catch (err) {
      console.error(err)
      if (!stopped) onModelError('No se pudieron cargar los modelos de detección.')
      return
    }

    if (stopped) return
    timer = setInterval(tick, smooth.loopMs)
  })()

  function cleanup() {
    stopped = true
    if (timer) clearInterval(timer)
  }

  return {
    stop: cleanup,
    resetItem(id) {
      delete states[id]
    },
  }
}

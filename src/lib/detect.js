import { CLASS_BIAS, SMOOTHING } from './config'
import { activeModelIds, isItemReady, predictItems, preloadModels } from './modelCache'


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
 * Guantes (YLkRIfGZJ): "Con guantes" es bien, "Sin guantes" es sin.
 * Este modelo no tiene clase de mal puesto o deteriorados.
 * Modelos anteriores: "Guantes bien puestos" es bien, "Guantes deteriorados" es mal, "Mal Puesto" es mal.
 * Solo en guantes: una clase de fondo ("Sin manos", "Fondo", "Nada", "Ninguno", "Vacío"...)
 * es "ninguno": no valida ni cuenta como sin guantes. Con el modelo de 2 clases nunca aparece.
 */
export function normalizeLabel(label) {
  return String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isBackgroundLabel(label) {
  const n = normalizeLabel(label)
  return /\b(sin manos?|no hay manos?|manos? no visibles?|fondo|nada|ningun[oa]?|vacio|background|sin persona)\b/.test(n)
}

export function mapLabel(label, item) {
  if (item === 'guantes' && isBackgroundLabel(label)) return 'ninguno'
  const n = normalizeLabel(label)
  if (n.includes('con guantes') || n === 'con guante') return 'bien'
  if (n.includes('deterior')) return 'mal'
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

export function rawProbsFromPredictions(predictions, item) {
  const probs = { bien: 0, mal: 0, sin: 0, ninguno: 0 }
  for (const pred of predictions || []) {
    const key = mapLabel(pred.className, item)
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
  const ninguno = probs.ninguno || 0
  const topIsMal = mal >= bien && mal >= sin
  if (topIsMal && sin >= bias.sinOverMal && bien < bias.bienMaxWhenPreferSin) {
    return { bien, mal: 0, sin: Math.max(sin, mal), ninguno }
  }
  return { bien, mal, sin, ninguno }
}

export function probsFromPredictions(predictions, bias = CLASS_BIAS, item) {
  return preferSin(rawProbsFromPredictions(predictions, item), bias)
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
    ninguno: probs.ninguno || 0,
  })
  const cutoff = now - smooth.windowMs
  state.history = state.history.filter(sample => sample.t >= cutoff)

  const avgBien = mean(state.history.map(sample => sample.bien))
  const avgMal = mean(state.history.map(sample => sample.mal))
  const avgSin = mean(state.history.map(sample => sample.sin))
  const avgNinguno = mean(state.history.map(sample => sample.ninguno || 0))
  state.pBien = avgBien
  // Fondo (solo modelos con esa clase): gana si supera a mal y a sin.
  const other = () => (avgNinguno > avgMal && avgNinguno > avgSin ? 'ninguno' : avgMal >= avgSin ? 'mal' : 'sin')

  // Los primeros cuadros, antes de llenar la ventana, no fijan ni muestran estado.
  if (now - state.firstT < smooth.windowMs) {
    state.status = null
    state.conf = 0
    return state
  }

  let status = state.status
  if (status === 'bien') {
    if (avgBien <= smooth.offThreshold) {
      status = other()
    }
  } else if (avgBien >= smooth.onThreshold) {
    status = 'bien'
  } else {
    const next = other()
    if ((status !== 'mal' && status !== 'sin') || next === 'ninguno') {
      status = next
    } else if (next !== status) {
      const winner = Math.max(avgMal, avgSin)
      const loser = Math.min(avgMal, avgSin)
      if (winner - loser >= (smooth.malSinMargin ?? 0.15)) status = next
    }
  }

  state.status = status
  state.conf = status === 'bien' ? avgBien : status === 'mal' ? avgMal : status === 'ninguno' ? avgNinguno : avgSin
  return state
}

export function modeledItems() {
  return activeModelIds()
}

/**
 * Predice cada ~200 ms sobre el video ya abierto, solo las piezas que pide activeItems
 * (en el flujo por partes, una sola). El extractor corre una vez por cuadro.
 * La cámara la maneja useCamera: al cambiar de lente solo se reemplaza
 * srcObject, este intervalo sigue siendo el único.
 */
export function startDetection({ videoRef, onResults, onFrame, onModelError, isFrozen, activeItems }) {
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
    const ids = (activeItems ? activeItems() : modeledItems()).filter(isItemReady)
    if (!ids.length) return
    busy = true
    try {
      const now = Date.now()
      const predictions = await predictItems(ids, video)
      if (stopped || isFrozen?.()) return
      const out = {}
      for (const id of ids) {
        if (!predictions[id]) continue
        if (!states[id]) states[id] = { history: [], status: null, conf: 0 }
        applySmoothing(states[id], probsFromPredictions(predictions[id], CLASS_BIAS, id), now, smooth)
        out[id] = {
          status: states[id].status,
          conf: +states[id].conf.toFixed(2),
          pBien: +(states[id].pBien || 0).toFixed(2),
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

  preloadModels().catch(err => {
    console.error(err)
    if (!stopped) onModelError?.('No se pudieron cargar los modelos de detección.')
  })
  timer = setInterval(tick, smooth.loopMs)

  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
    },
    resetItem(id) {
      delete states[id]
    },
  }
}

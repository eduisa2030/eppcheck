// Flujo de validación por partes.
//   pledge -> step (casco) -> step (lentes) -> step (chaleco) -> step (guantes) -> photo -> done
// Cada pieza validada queda FIJA: nunca se revoca después.
// En cada paso solo se predice la pieza actual.
import { GLOVES, SCAN } from './config'
import { ITEMS } from './models'

export const PLEDGE_TEXT = 'Me comprometo a portar todo mi EPP durante el turno. Quitarme una pieza ya validada va en contra del reglamento de seguridad de la empresa.'

const NAMES = { casco: 'casco', lentes: 'lentes', chaleco: 'chaleco', guantes: 'guantes' }

export function stepPrompt(id) {
  if (id === 'guantes') return 'Primero muestra tu mano sin guante y luego con guantes'
  if (id === 'lentes') return 'Acerca tu cara a la cámara con los lentes puestos'
  if (id === 'chaleco') return 'Aléjate un poco para que se vea tu chaleco'
  return 'Ponte frente a la cámara con el casco puesto'
}

export function stepTitle(state) {
  if (!state) return ''
  if (state.phase === 'step') return `Paso ${state.index + 1} de ${state.steps.length + 1} · ${NAMES[state.steps[state.index]] || state.steps[state.index]}`
  if (state.phase === 'photo') return `Paso ${state.steps.length + 1} de ${state.steps.length + 1} · Foto de evidencia`
  return ''
}

export function initialScan(items, now = Date.now()) {
  const have = new Set(items || [])
  const steps = ITEMS.filter(id => have.has(id))
  return {
    phase: 'pledge',
    steps,
    index: 0,
    stepStartedAt: now,
    bienSince: null,
    final: {},
    live: {},
    pledge: null,
    photo: null,
  }
}

export function currentItem(state) {
  return state?.phase === 'step' ? state.steps[state.index] || null : null
}

/** Solo la pieza del paso actual. */
export function activeScanItems(state) {
  const id = currentItem(state)
  return id ? [id] : []
}

export function acceptPledge(state, operator, now = Date.now()) {
  if (!state || state.phase !== 'pledge') return state
  const at = new Date(now)
  const pledge = {
    aceptada: true,
    texto: PLEDGE_TEXT,
    operador: operator,
    timestamp: at.toISOString(),
    fecha: at.toLocaleDateString('es-MX'),
    hora: at.toLocaleTimeString('es-MX', { hour12: false }),
  }
  return enterStep({ ...state, pledge }, 0, now)
}

function enterStep(state, index, now) {
  if (index >= state.steps.length) return { ...state, phase: 'photo', index, bienSince: null }
  const id = state.steps[index]
  const live = { ...state.live }
  delete live[id]
  return { ...state, phase: 'step', index, stepStartedAt: now, bienSince: null, gloveSinSeen: false, gloveArmed: false, live }
}

/**
 * Sub-fase del paso de guantes: 'pausa' (acerca las manos), 'sin' (falta ver la mano
 * sin guante) o 'con' (ya se vio; ahora con guantes). null si el paso no es guantes.
 */
export function glovePhase(state) {
  if (currentItem(state) !== 'guantes') return null
  if (!state.gloveArmed) return 'pausa'
  return state.gloveSinSeen ? 'con' : 'sin'
}

function record(state, id, status, conf, now) {
  const at = new Date(now)
  return {
    ...state,
    final: {
      ...state.final,
      [id]: {
        status,
        conf,
        locked: status === 'bien',
        timestamp: at.toISOString(),
        hora: at.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      },
    },
  }
}

/** Botón Capturar en un paso: registra el estado del momento y avanza. */
export function captureStep(state, now = Date.now()) {
  const id = currentItem(state)
  if (!id) return state
  const current = state.live[id]
  let raw = current?.status
  // Guantes: Capturar solo registra «bien» si ya se cumplió la regla (mano sin guante antes y >= 90%).
  if (id === 'guantes' && raw === 'bien' && !(state.gloveSinSeen && (current?.pBien ?? 0) >= GLOVES.onThreshold)) raw = null
  const status = raw === 'bien' || raw === 'mal' || raw === 'sin' || raw === 'ninguno' ? raw : 'no_detectado'
  const conf = status === 'no_detectado' ? 0 : (current?.conf ?? 0)
  return enterStep(record(state, id, status, conf, now), state.index + 1, now)
}

/** Botón Capturar en la foto de cuerpo completo: no pasa por el modelo. */
export function capturePhoto(state, photo) {
  if (!state || state.phase !== 'photo') return state
  return { ...state, phase: 'done', photo: photo || null }
}

/** Avanza con el resultado ya suavizado del cuadro. Solo puede validar; nunca revoca. */
export function reduceScan(state, { predictions = {}, now }, flow = SCAN, gloves = GLOVES) {
  const id = currentItem(state)
  if (!id) return { state, resetIds: [] }
  const pred = predictions[id]
  if (!pred) return { state, resetIds: [] }
  if (id === 'guantes') return reduceGloves(state, pred, now, gloves)
  const live = { ...state.live, [id]: { status: pred.status || state.live[id]?.status, conf: pred.conf ?? 0, pBien: pred.pBien } }
  let next = { ...state, live }
  let bienSince = next.bienSince
  if (pred.status === 'bien') {
    if (bienSince == null) bienSince = now
  } else {
    bienSince = null
  }
  next = { ...next, bienSince }
  if (pred.status === 'bien' && now - bienSince >= flow.latchMs) {
    next = enterStep(record(next, id, 'bien', pred.conf, now), next.index + 1, now)
    return { state: next, resetIds: [id] }
  }
  return { state: next, resetIds: [] }
}

/**
 * Guantes: pausa inicial (se descarta lo visto y se reinicia la ventana), luego hay que ver
 * «Sin guantes» y después «Con guantes» >= onThreshold sostenido holdMs. «ninguno» (fondo) no cuenta.
 */
function reduceGloves(state, pred, now, gloves) {
  const id = 'guantes'
  if (now - (state.stepStartedAt || 0) < gloves.pauseMs) {
    const live = { ...state.live, [id]: { status: null, conf: 0, pBien: null } }
    return { state: { ...state, live, bienSince: null }, resetIds: [id] }
  }
  const gloveSinSeen = Boolean(state.gloveSinSeen) || (pred.status === 'sin' && (pred.conf ?? 0) >= gloves.sinMin)
  // Antes de ver la mano sin guante, un «Con guantes» no se muestra (suele ser el fondo).
  const hideBien = !gloveSinSeen && pred.status === 'bien'
  const live = {
    ...state.live,
    [id]: hideBien
      ? { status: null, conf: 0, pBien: null }
      : { status: pred.status || state.live[id]?.status, conf: pred.conf ?? 0, pBien: pred.pBien },
  }
  const strongBien = gloveSinSeen && pred.status === 'bien' && (pred.pBien ?? 0) >= gloves.onThreshold
  const bienSince = strongBien ? (state.bienSince ?? now) : null
  let next = { ...state, live, gloveSinSeen, gloveArmed: true, bienSince }
  if (strongBien && now - bienSince >= gloves.holdMs) {
    next = enterStep(record(next, id, 'bien', pred.conf, now), next.index + 1, now)
    return { state: next, resetIds: [id] }
  }
  return { state: next, resetIds: [] }
}

/** Resultado final: todas las piezas con modelo deben estar en «bien». */
export function scanResult(state) {
  const details = {}
  for (const id of state.steps) {
    const row = state.final[id]
    details[id] = row ? { ...row } : { status: 'no_detectado', conf: 0, locked: false }
  }
  const missing = state.steps.filter(id => details[id].status !== 'bien')
  return { details, missing, cumple: state.steps.length > 0 && missing.length === 0 }
}

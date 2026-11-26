// Flujo de validación por partes.
//   pledge -> step (casco) -> step (lentes) -> step (chaleco) -> step (guantes) -> photo -> done
// Cada pieza validada queda FIJA: nunca se revoca después.
// En cada paso solo se predice la pieza actual.
import { SCAN } from './config'
import { ITEMS } from './models'

export const PLEDGE_TEXT = 'Me comprometo a portar todo mi EPP durante el turno. Quitarme una pieza ya validada va en contra del reglamento de seguridad de la empresa.'

const NAMES = { casco: 'casco', lentes: 'lentes', chaleco: 'chaleco', guantes: 'guantes' }

export function stepPrompt(id) {
  if (id === 'guantes') return 'Acerca tus manos con guantes a la cámara'
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
  return { ...state, phase: 'step', index, stepStartedAt: now, bienSince: null, live }
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
  const raw = current?.status
  const status = raw === 'bien' || raw === 'mal' || raw === 'sin' ? raw : 'no_detectado'
  const conf = status === 'no_detectado' ? 0 : (current?.conf ?? 0)
  return enterStep(record(state, id, status, conf, now), state.index + 1, now)
}

/** Botón Capturar en la foto de cuerpo completo: no pasa por el modelo. */
export function capturePhoto(state, photo) {
  if (!state || state.phase !== 'photo') return state
  return { ...state, phase: 'done', photo: photo || null }
}

/** Avanza con el resultado ya suavizado del cuadro. Solo puede validar; nunca revoca. */
export function reduceScan(state, { predictions = {}, now }, flow = SCAN) {
  const id = currentItem(state)
  if (!id) return { state, resetIds: [] }
  const pred = predictions[id]
  if (!pred) return { state, resetIds: [] }
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

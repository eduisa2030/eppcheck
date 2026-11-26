import { SCAN } from './config'

export function stepPrompt(id) {
  return `Ahora: ${id} — acércate a la cámara`
}

export function revokePrompt(id) {
  return `Vuelve a ponerte el ${id}`
}

export function armScan(state, now) {
  if (!state || state.clockStarted || state.phase === 'done' || state.phase === 'timeout') return state
  return { ...state, clockStarted: true, startedAt: now, stepStartedAt: now }
}

export function initialScan(items, now) {
  return {
    phase: items.length ? 'step' : 'done',
    items,
    index: 0,
    startedAt: now,
    stepStartedAt: now,
    verifyStartedAt: null,
    clockStarted: false,
    bienSince: null,
    locked: {},
    final: {},
    live: {},
    notice: '',
  }
}

export function activeScanItems(state) {
  if (!state || state.phase === 'done' || state.phase === 'timeout') return []
  if (state.phase === 'verify' || state.phase === 'ready') return state.items
  const id = state.items[state.index]
  return id ? [id] : []
}

/** Todos los elementos del escaneo están en "bien" en este momento. */
export function isScanValidated(state) {
  if (!state?.items?.length) return false
  return state.items.every(id => {
    const status = state.live[id]?.status || state.final[id]?.status
    return status === 'bien'
  })
}

/** El operador captura el cuadro y cierra el escaneo. */
export function finishScan(state) {
  if (!state || state.phase === 'done' || state.phase === 'timeout') return state
  return { ...state, phase: 'done', notice: '' }
}

function enterStep(state, index, now, notice) {
  const id = state.items[index]
  const live = { ...state.live }
  if (id) delete live[id]
  return {
    state: {
      ...state,
      phase: 'step',
      index,
      stepStartedAt: now,
      verifyStartedAt: null,
      bienSince: null,
      notice: notice || '',
      live,
    },
    resetIds: id ? [id] : [],
  }
}

function enterVerify(state, now) {
  return {
    state: {
      ...state,
      phase: 'verify',
      verifyStartedAt: now,
      bienSince: null,
      notice: 'Revisando que todo siga puesto…',
    },
    resetIds: [],
  }
}

function moveForward(state, now) {
  for (let i = state.index + 1; i < state.items.length; i++) {
    if (!state.locked[state.items[i]]) return enterStep(state, i, now, '')
  }
  return enterVerify(state, now)
}

function timeoutScan(state, now) {
  return {
    state: {
      ...initialScan(state.items, now),
      phase: 'timeout',
      clockStarted: true,
      notice: 'Se agotó el tiempo del escaneo.',
    },
    resetIds: state.items.slice(),
  }
}

function latchInPlace(state, id, pred) {
  return {
    ...state,
    locked: { ...state.locked, [id]: true },
    final: { ...state.final, [id]: { status: 'bien', conf: pred.conf, locked: true } },
    live: { ...state.live, [id]: { status: 'bien', conf: pred.conf } },
  }
}

function latch(state, id, pred, now) {
  return moveForward({
    ...state,
    bienSince: null,
    locked: { ...state.locked, [id]: true },
    final: { ...state.final, [id]: { status: 'bien', conf: pred.conf, locked: true } },
    live: { ...state.live, [id]: { status: 'bien', conf: pred.conf } },
  }, now)
}

function giveUp(state, id, pred, now) {
  const status = pred?.status === 'mal' || pred?.status === 'sin' ? pred.status : 'no_detectado'
  const conf = status === 'no_detectado' ? 0 : pred.conf
  return moveForward({
    ...state,
    bienSince: null,
    final: { ...state.final, [id]: { status, conf, locked: false } },
    live: { ...state.live, [id]: { status, conf } },
  }, now)
}

function revoke(state, id, now) {
  const locked = { ...state.locked }
  const final = { ...state.final }
  delete locked[id]
  delete final[id]
  const index = Math.max(0, state.items.indexOf(id))
  return enterStep({ ...state, locked, final, index }, index, now, revokePrompt(id))
}

/**
 * Avanza el escaneo con el resultado ya suavizado del tick.
 * Solo el paso actual se predice; la verificación y la espera de Capturar miran todos los modelos.
 */
export function reduceScan(state, { predictions = {}, now }, flow = SCAN) {
  if (state.phase === 'done' || state.phase === 'timeout') return { state, resetIds: [] }

  let next = state
  if (!next.clockStarted) {
    if (!Object.keys(predictions).length) return { state, resetIds: [] }
    next = { ...next, clockStarted: true, startedAt: now, stepStartedAt: now }
  }

  // En ready el operador ya validó y puede tardar en pulsar Capturar.
  if (next.phase !== 'ready' && now - next.startedAt >= flow.scanTimeoutMs) return timeoutScan(next, now)

  const live = { ...next.live }
  for (const [id, pred] of Object.entries(predictions)) {
    if (pred?.status) live[id] = { status: pred.status, conf: pred.conf }
  }
  next = { ...next, live }

  if (next.phase === 'verify' || next.phase === 'ready') {
    const sinConfidence = flow.sinConfidence ?? 0.75
    const revoked = next.items.find(id => {
      const pred = predictions[id]
      return next.locked[id] && pred?.status === 'sin' && pred.conf >= sinConfidence
    })
    if (revoked) return revoke(next, revoked, now)
    if (next.phase === 'verify' && now - next.verifyStartedAt >= flow.verifyMs) {
      return { state: { ...next, phase: 'ready', notice: '' }, resetIds: [] }
    }
    // En ready se puede recuperar un elemento que había fallado o se había soltado.
    if (next.phase === 'ready') {
      for (const id of next.items) {
        if (next.locked[id]) continue
        const pred = predictions[id]
        if (pred?.status === 'bien') next = latchInPlace(next, id, pred)
      }
    }
    return { state: next, resetIds: [] }
  }

  const id = next.items[next.index]
  const pred = predictions[id]
  let bienSince = next.bienSince
  if (pred?.status === 'bien') {
    if (bienSince == null) bienSince = now
  } else if (pred) {
    bienSince = null
  }
  next = { ...next, bienSince }

  if (pred?.status === 'bien' && now - bienSince >= flow.latchMs) return latch(next, id, pred, now)
  if (now - next.stepStartedAt >= flow.stepTimeoutMs) return giveUp(next, id, pred, now)
  return { state: next, resetIds: [] }
}

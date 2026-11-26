import { SCAN } from './config'
import { BODY_ITEMS, HAND_ITEMS } from './models'

export function stepPrompt(id, shot) {
  if (id === 'guantes' || shot === 'hands') return 'Acerca tus manos con guantes a la cámara'
  return `Ahora: ${id} — acércate a la cámara`
}

export function revokePrompt(id) {
  return `Vuelve a ponerte el ${id}`
}

export function shotTitle(state) {
  const shots = state?.shots || []
  if (shots.length < 2) return ''
  const i = (state.shotIndex || 0) + 1
  if (state.shot === 'hands') return `Toma ${i} de ${shots.length} · Guantes`
  return `Toma ${i} de ${shots.length} · Cuerpo y cara`
}

export function hasNextShot(state) {
  return (state?.shotIndex || 0) + 1 < (state?.shots?.length || 0)
}

export function armScan(state, now) {
  if (!state || state.clockStarted || state.phase === 'done' || state.phase === 'timeout') return state
  return { ...state, clockStarted: true, startedAt: now, stepStartedAt: now }
}

function buildShots(ids) {
  const have = new Set(ids || [])
  const shots = []
  const body = BODY_ITEMS.filter(id => have.has(id))
  const hands = HAND_ITEMS.filter(id => have.has(id))
  if (body.length) shots.push({ id: 'body', items: body })
  if (hands.length) shots.push({ id: 'hands', items: hands })
  return shots
}

export function initialScan(items, now) {
  const shots = buildShots(items)
  const current = shots[0]
  return {
    phase: current ? 'step' : 'done',
    shot: current?.id || 'body',
    shotIndex: 0,
    shots,
    items: current?.items || [],
    allItems: shots.flatMap(shot => shot.items),
    index: 0,
    startedAt: now,
    stepStartedAt: now,
    verifyStartedAt: null,
    clockStarted: false,
    bienSince: null,
    locked: {},
    final: {},
    live: {},
    photos: {},
    notice: '',
  }
}

export function activeScanItems(state) {
  if (!state || state.phase === 'done' || state.phase === 'timeout') return []
  if (state.phase === 'verify' || state.phase === 'ready') return state.items
  const id = state.items[state.index]
  return id ? [id] : []
}

/** Los elementos de la toma actual están en "bien" en este momento. */
export function isScanValidated(state) {
  if (!state?.items?.length) return false
  return state.items.every(id => {
    const status = state.live[id]?.status || state.final[id]?.status
    return status === 'bien'
  })
}

export function finishScan(state) {
  if (!state || state.phase === 'done' || state.phase === 'timeout') return state
  return { ...state, phase: 'done', notice: '' }
}

function enterShot(state, shotIndex, photos, now) {
  const shot = state.shots[shotIndex]
  const live = { ...state.live }
  for (const id of shot?.items || []) delete live[id]
  return {
    ...state,
    phase: shot ? 'step' : 'done',
    shot: shot?.id || state.shot,
    shotIndex,
    items: shot?.items || [],
    index: 0,
    startedAt: now,
    stepStartedAt: now,
    verifyStartedAt: null,
    bienSince: null,
    clockStarted: false,
    photos: photos || state.photos || {},
    notice: '',
    live,
  }
}

/** Congela el estado actual de la toma: «bien» queda bien; el resto, no validado. */
export function freezeShotItems(state) {
  const final = { ...state.final }
  const locked = { ...state.locked }
  const live = { ...state.live }
  for (const id of state.items || []) {
    const current = live[id] || final[id]
    const raw = current?.status
    const status = raw === 'bien' || raw === 'mal' || raw === 'sin' ? raw : 'no_detectado'
    const conf = status === 'no_detectado' ? 0 : (current?.conf ?? 0)
    final[id] = { status, conf, locked: status === 'bien' }
    live[id] = { status, conf }
    if (status === 'bien') locked[id] = true
    else delete locked[id]
  }
  return { ...state, final, locked, live }
}

/** Guarda la foto y el estado de la toma actual. Si hay otra toma, avanza; si no, cierra el escaneo. */
export function captureShot(state, photo, now) {
  if (!state || state.phase === 'done' || state.phase === 'timeout') return state
  const frozen = freezeShotItems(state)
  const photos = { ...(frozen.photos || {}) }
  if (frozen.shot) photos[frozen.shot] = photo || null
  if (hasNextShot(frozen)) return enterShot(frozen, frozen.shotIndex + 1, photos, now)
  return { ...frozen, phase: 'done', notice: '', photos }
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
      notice: state.shot === 'hands' ? 'Revisando los guantes…' : 'Revisando que todo siga puesto…',
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
      ...initialScan(state.allItems || state.items, now),
      phase: 'timeout',
      clockStarted: true,
      notice: 'Se agotó el tiempo del escaneo.',
      photos: state.photos || {},
      locked: state.locked,
      final: state.final,
    },
    resetIds: (state.allItems || state.items).slice(),
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
 * En cada toma solo se predice el paso actual; la verificación y Capturar
 * miran únicamente los elementos de esa toma, no los de la otra.
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
    // Solo se puede revocar un elemento de la toma actual, nunca el casco en la toma de guantes.
    const revoked = next.items.find(id => {
      const pred = predictions[id]
      return next.locked[id] && pred?.status === 'sin' && pred.conf >= sinConfidence
    })
    if (revoked) return revoke(next, revoked, now)
    if (next.phase === 'verify' && now - next.verifyStartedAt >= flow.verifyMs) {
      return { state: { ...next, phase: 'ready', notice: '' }, resetIds: [] }
    }
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

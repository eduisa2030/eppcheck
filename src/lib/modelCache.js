// Motor de modelos de EPP Check.
//
// Los 4 modelos de Teachable Machine comparten el mismo extractor MobileNet
// (verificado byte a byte en scripts/split-models.mjs). Por eso:
//   - el extractor se descarga, se sube a la GPU y se calienta UNA sola vez;
//   - cada pieza (casco, lentes, chaleco, guantes) solo tiene su cabeza densa (~0.5 MB);
//   - en cada cuadro se corre el extractor una vez y luego solo la cabeza de la pieza que toca.
// La salida es la misma que la del modelo original de Teachable Machine.
import manifest from './modelManifest.json'
import { ITEMS } from './models'
import { loadTf } from './tm'

const ORDER = ITEMS.filter(id => manifest.items[id])
const FIRST = ORDER[0]
const listeners = new Set()
const heads = new Map() // id -> { model, labels }
const bases = new Map() // baseId -> model
const downloads = new Map()
const itemWaits = new Map()
let started = false
let startedAt = 0
let tfRef = null
let progress = {
  stage: 'red',
  total: ORDER.length,
  loaded: 0,
  ready: false,
  handsReady: false,
  allReady: false,
  itemsReady: {},
  error: '',
}

function since() {
  return startedAt ? Math.round(performance.now() - startedAt) : 0
}

function log(data) {
  console.info('[epp-model]', JSON.stringify({ at: since(), ...data }))
}

function setProgress(patch) {
  progress = { ...progress, ...patch }
  progress.loaded = Object.values(progress.itemsReady).filter(Boolean).length
  listeners.forEach(fn => fn(progress))
}

export function subscribeModelProgress(listener) {
  listeners.add(listener)
  listener(progress)
  return () => listeners.delete(listener)
}

export function activeModelIds() {
  return ORDER.slice()
}

export function hasActiveModel(id) {
  return Boolean(manifest.items[id])
}

export function isItemReady(id) {
  return heads.has(id) && bases.has(manifest.items[id]?.base)
}

export function modelStatusText(p = progress) {
  if (p.error) return 'No se pudieron cargar los modelos'
  if (!p.ready) return p.stage === 'gpu' ? 'Preparando el modelo en el teléfono…' : 'Descargando el modelo…'
  if (!p.allReady) return `Listo para escanear · ${p.loaded}/${p.total} piezas`
  return ''
}

function urlOf(path) {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

function idbKey(entry) {
  return `indexeddb://eppcheck-${entry.hash}`
}

function idbFlag(entry) {
  return `eppcheck_idb_${entry.hash}`
}

function inIdb(entry) {
  try { return localStorage.getItem(idbFlag(entry)) === '1' } catch { return false }
}

/** Descarga model.json y los pesos en paralelo (no espera a leer el JSON para pedir los pesos). */
function download(entry) {
  if (!downloads.has(entry.model)) {
    const p = Promise.all([
      fetch(urlOf(entry.model)).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} en ${entry.model}`)
        return r.json()
      }),
      fetch(urlOf(entry.weights)).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} en ${entry.weights}`)
        return r.arrayBuffer()
      }),
    ])
    p.catch(() => downloads.delete(entry.model))
    downloads.set(entry.model, p)
  }
  return downloads.get(entry.model)
}

async function buildLayers(tf, entry) {
  if (inIdb(entry)) {
    try {
      const model = await tf.loadLayersModel(idbKey(entry))
      return { model, source: 'idb' }
    } catch (err) {
      console.warn('[epp-model] caché del navegador inválida, se descarga', entry.model, err)
      try { localStorage.removeItem(idbFlag(entry)) } catch {}
    }
  }
  const [json, weightData] = await download(entry)
  const model = await tf.loadLayersModel(tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest.flatMap(group => group.weights),
    weightData,
    format: json.format,
    generatedBy: json.generatedBy,
    convertedBy: json.convertedBy,
  }))
  return { model, source: 'network' }
}

function persist(entry, model) {
  // Después de estar listos, para no competir con la GPU.
  setTimeout(() => {
    model.save(idbKey(entry)).then(() => {
      try { localStorage.setItem(idbFlag(entry), '1') } catch {}
    }).catch(err => console.warn('[epp-model] no se pudo guardar en el navegador', err))
  }, 1500)
}

/** Recorta el centro y escala a size×size, igual que cropTo de @teachablemachine/image. */
function cropTo(image, size, canvas) {
  let width = image.width
  let height = image.height
  if (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) {
    width = image.videoWidth
    height = image.videoHeight
  }
  const min = Math.min(width, height)
  const scale = size / min
  const scaledW = Math.ceil(width * scale)
  const scaledH = Math.ceil(height * scale)
  const dx = scaledW - size
  const dy = scaledH - size
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, ~~(dx / 2) * -1, ~~(dy / 2) * -1, scaledW, scaledH)
  return canvas
}

/** Igual que capture() de @teachablemachine/image: píxeles 0-255 a [-1, 1]. */
function toInput(tf, canvas) {
  // Operaciones funcionales: el bundle no registra los métodos encadenados (x.div()...).
  const batched = tf.expandDims(tf.browser.fromPixels(canvas), 0)
  return tf.sub(tf.div(tf.cast(batched, 'float32'), tf.scalar(127)), tf.scalar(1))
}

function makeCanvas() {
  // Un canvas nuevo por cuadro, igual que @teachablemachine/image.
  return document.createElement('canvas')
}

async function warmBase(tf, base) {
  // Cuadro gris de 224×224 por el mismo camino que la cámara: compila todos los shaders una vez.
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 224
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#777'
  ctx.fillRect(0, 0, 224, 224)
  const out = tf.tidy(() => base.predict(toInput(tf, canvas)))
  await out.data()
  out.dispose()
}

async function warmHead(tf, head) {
  const out = tf.tidy(() => head.predict(tf.zeros([1, head.inputs[0].shape[1]])))
  await out.data()
  out.dispose()
}

function waitFor(id) {
  if (!itemWaits.has(id)) {
    let resolve
    const promise = new Promise(r => { resolve = r })
    itemWaits.set(id, { promise, resolve })
  }
  return itemWaits.get(id)
}

export function whenItemReady(id) {
  if (isItemReady(id)) return Promise.resolve()
  preloadModels()
  return waitFor(id).promise
}

async function run() {
  startedAt = performance.now()
  const firstEntry = manifest.items[FIRST]
  const baseEntry = manifest.bases[firstEntry.base]
  log({ phase: 'inicio', items: ORDER, base: firstEntry.base, idb: inIdb(baseEntry) })
  // Primero lo que necesita el primer paso (extractor + casco); el resto después.
  if (!inIdb(baseEntry)) download(baseEntry)
  if (!inIdb(firstEntry)) download(firstEntry)

  const tf = await loadTf()
  tfRef = tf
  let ok = false
  try { ok = await tf.setBackend('webgl') } catch (err) { console.warn('WebGL no disponible', err) }
  if (!ok) await tf.setBackend('cpu')
  await tf.ready()
  log({ phase: 'tf', backend: tf.getBackend(), version: tf.version?.tfjs })
  setProgress({ stage: 'red' })

  const others = ORDER.filter(id => id !== FIRST)
  const ensureBase = async (baseId) => {
    if (bases.has(baseId)) return bases.get(baseId)
    const entry = manifest.bases[baseId]
    const { model, source } = await buildLayers(tf, entry)
    log({ phase: 'base-cargado', source })
    setProgress({ stage: 'gpu' })
    await warmBase(tf, model)
    bases.set(baseId, model)
    log({ phase: 'base-listo', source })
    if (source === 'network') persist(entry, model)
    return model
  }
  const buildItem = async (id) => {
    const entry = manifest.items[id]
    await ensureBase(entry.base)
    const { model, source } = await buildLayers(tf, entry)
    await warmHead(tf, model)
    heads.set(id, { model, labels: entry.labels, base: entry.base })
    if (source === 'network') persist(entry, model)
    log({ id, phase: 'listo', source })
    const itemsReady = { ...progress.itemsReady, [id]: true }
    const allReady = ORDER.every(item => itemsReady[item])
    setProgress({
      itemsReady,
      ready: Boolean(itemsReady[FIRST]),
      handsReady: !manifest.items.guantes || Boolean(itemsReady.guantes),
      allReady,
      stage: allReady ? 'listo' : progress.stage,
    })
    waitFor(id).resolve()
  }

  await buildItem(FIRST)
  log({ phase: 'primero-listo', id: FIRST })
  for (const id of others) if (!inIdb(manifest.items[id])) download(manifest.items[id])
  for (const id of others) await buildItem(id)
  log({ phase: 'listos' })
}

let runPromise = null
export function preloadModels() {
  if (!started) {
    started = true
    runPromise = run().catch(err => {
      console.error('[epp-model] error', err)
      setProgress({ stage: 'error', error: String(err?.message || err) })
      started = false
      throw err
    })
  }
  return runPromise
}

/**
 * Probabilidades de cada pieza pedida sobre el cuadro actual.
 * El extractor corre una sola vez por cuadro; luego cada cabeza.
 * Devuelve { id: [{ className, probability }] } solo de las piezas listas.
 */
export async function predictItems(ids, image) {
  const tf = tfRef
  const ready = ids.filter(isItemReady)
  if (!tf || !ready.length) return {}
  const canvas = cropTo(image, 224, makeCanvas())
  const outputs = tf.tidy(() => {
    const byBase = new Map()
    return ready.map(id => {
      const head = heads.get(id)
      if (!byBase.has(head.base)) byBase.set(head.base, bases.get(head.base).predict(toInput(tf, canvas)))
      return head.model.predict(byBase.get(head.base))
    })
  })
  try {
    const values = await Promise.all(outputs.map(t => t.data()))
    const result = {}
    ready.forEach((id, i) => {
      const labels = heads.get(id).labels
      result[id] = Array.from(values[i]).map((probability, k) => ({ className: labels[k], probability }))
    })
    return result
  } finally {
    outputs.forEach(t => t.dispose())
  }
}

// Arranca la descarga en cuanto se importa el módulo.
if (typeof window !== 'undefined') preloadModels().catch(() => {})

// Para pruebas desde la consola: window.__eppDebug.predictItems(['casco'], imagen)
if (typeof window !== 'undefined') window.__eppDebug = { predictItems, progress: () => progress }

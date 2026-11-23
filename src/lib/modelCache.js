import { ITEMS } from './models'
import { MODELS } from './config'
import { getModelUrls } from './api'
import { loadTM } from './tm'

const memory = new Map()
const inflight = new Map()
const prefetched = new Map()
let bootPromise = null
let preloadPromise = null
let resolved = null
let startedAt = 0
let progress = { loaded: 0, total: 0, ready: false, models: {} }
const listeners = new Set()

function emit() {
  const loaded = Object.values(progress.models).filter(item => (
    item.phase === 'memoria' || item.phase === 'calentando' || item.phase === 'listo' || item.phase === 'cache'
  )).length
  progress = { ...progress, loaded }
  listeners.forEach(fn => fn(progress))
}

function mark(id, phase, extra = {}) {
  const at = startedAt ? Math.round(performance.now() - startedAt) : 0
  progress = {
    ...progress,
    models: { ...progress.models, [id]: { phase, at, ...extra } },
  }
  console.info('[epp-model]', JSON.stringify({ id, phase, at, ...extra }))
  emit()
}

export function subscribeModelProgress(listener) {
  listeners.add(listener)
  listener(progress)
  return () => listeners.delete(listener)
}

export function activeModelIds() {
  const urls = resolved || MODELS
  return ITEMS.filter(id => typeof urls[id] === 'string' && urls[id].trim())
}

export function modelUrlFor(id) {
  const urls = resolved || MODELS
  return (urls[id] || '').trim()
}

export function hasActiveModel(id) {
  return Boolean(modelUrlFor(id))
}

export function getModel(id) {
  const url = normalizeUrl(modelUrlFor(id))
  if (!url) return null
  return memory.get(url) || null
}

function normalizeUrl(url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function hashUrl(url) {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = Math.imul(31, hash) + url.charCodeAt(i) | 0
  return (hash >>> 0).toString(36)
}

function storageKey(id, suffix) {
  return `eppcheck_model_${suffix}_${id}`
}

function configUrls() {
  const urls = {}
  for (const id of ITEMS) urls[id] = normalizeUrl(MODELS[id] || '')
  return urls
}

async function bootTf() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await loadTM()
      const tf = window.tf
      if (!tf) throw new Error('TensorFlow.js no está cargado')
      try {
        await tf.setBackend('webgl')
      } catch (err) {
        console.warn('WebGL no disponible, se usa el backend por defecto', err)
      }
      await tf.ready()
      return tf
    })().catch(err => {
      bootPromise = null
      throw err
    })
  }
  return bootPromise
}

async function warmup(model) {
  const canvas = document.createElement('canvas')
  canvas.width = 224
  canvas.height = 224
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#777'
    ctx.fillRect(0, 0, 224, 224)
  }
  await model.predict(canvas)
}

function prefetch(url) {
  if (!prefetched.has(url)) prefetched.set(url, fetchBundle(url))
  return prefetched.get(url)
}

async function fetchBundle(url) {
  const modelJsonUrl = url + 'model.json'
  const [modelRes, metaRes] = await Promise.all([
    fetch(modelJsonUrl),
    fetch(url + 'metadata.json'),
  ])
  if (!modelRes.ok || !metaRes.ok) throw new Error(`No se pudo descargar ${url}`)
  const modelJSON = await modelRes.json()
  const metadata = await metaRes.json()
  const specs = []
  const parts = []
  for (const group of modelJSON.weightsManifest || []) {
    const buffers = await Promise.all((group.paths || []).map(async (path) => {
      const weightUrl = new URL(path, modelJsonUrl).href
      const response = await fetch(weightUrl)
      if (!response.ok) throw new Error(`No se pudieron leer los pesos de ${url}`)
      return response.arrayBuffer()
    }))
    specs.push(...(group.weights || []))
    parts.push(...buffers)
  }
  const total = parts.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const weightData = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    weightData.set(new Uint8Array(part), offset)
    offset += part.byteLength
  }
  return { modelJSON, metadata, specs, weightData: weightData.buffer }
}

async function layersFromBundle(tf, bundle) {
  const handler = tf.io.fromMemory({
    modelTopology: bundle.modelJSON.modelTopology,
    weightSpecs: bundle.specs,
    weightData: bundle.weightData,
    format: bundle.modelJSON.format,
    generatedBy: bundle.modelJSON.generatedBy,
    convertedBy: bundle.modelJSON.convertedBy,
  })
  return tf.loadLayersModel(handler)
}

async function fromIndexedDb(tf, tm, id, url) {
  const savedUrl = localStorage.getItem(storageKey(id, 'url'))
  const name = localStorage.getItem(storageKey(id, 'idb'))
  const metaRaw = localStorage.getItem(storageKey(id, 'meta'))
  if (savedUrl !== url || !name || !metaRaw) return null
  const metadata = JSON.parse(metaRaw)
  const layers = await tf.loadLayersModel(name)
  return { model: new tm.CustomMobileNet(layers, metadata), layers, metadata }
}

async function persist(tf, id, url, layers, metadata) {
  const name = `indexeddb://eppcheck-${id}-${hashUrl(url)}`
  const previous = localStorage.getItem(storageKey(id, 'idb'))
  if (previous && previous !== name) {
    try { await tf.io.removeModel(previous) } catch {}
  }
  await layers.save(name)
  localStorage.setItem(storageKey(id, 'idb'), name)
  localStorage.setItem(storageKey(id, 'url'), url)
  localStorage.setItem(storageKey(id, 'meta'), JSON.stringify(metadata))
  console.info('[epp-model]', JSON.stringify({ id, phase: 'guardado', url }))
}

async function downloadOne(tf, tm, id, url) {
  if (memory.has(url)) return { id, url, model: memory.get(url), layers: null, metadata: null, source: 'memory' }
  if (inflight.has(url)) return inflight.get(url)
  const job = (async () => {
    mark(id, 'descargando', { url })
    try {
      const cached = await fromIndexedDb(tf, tm, id, url)
      if (cached) {
        memory.set(url, cached.model)
        mark(id, 'memoria', { url, source: 'idb' })
        return { ...cached, id, url, source: 'idb' }
      }
    } catch (err) {
      console.warn('Caché local inválida, se descarga el modelo', id, err)
    }
    const bundle = await prefetch(url)
    mark(id, 'memoria', { url, source: 'network' })
    let layers
    try {
      layers = await layersFromBundle(tf, bundle)
    } catch (err) {
      console.warn('[epp-model] fromMemory falló, se carga desde la URL', id, err)
      layers = await tf.loadLayersModel(url + 'model.json')
    }
    const model = new tm.CustomMobileNet(layers, bundle.metadata)
    memory.set(url, model)
    return { id, url, model, layers, metadata: bundle.metadata, source: 'network' }
  })()
  inflight.set(url, job)
  try {
    return await job
  } finally {
    inflight.delete(url)
  }
}

async function resolveSheet(urls) {
  try {
    const remote = await getModelUrls()
    if (!remote || typeof remote !== 'object') return urls
    const next = { ...urls }
    for (const id of ITEMS) {
      if (typeof remote[id] === 'string') next[id] = normalizeUrl(remote[id])
    }
    return next
  } catch (err) {
    console.warn('No se pudieron leer los modelos de la hoja', err)
    return urls
  }
}

async function runPreload() {
  startedAt = performance.now()
  const initial = configUrls()
  resolved = { ...initial }
  const wanted = new Map(ITEMS.filter(id => initial[id]).map(id => [id, initial[id]]))
  const sheetPromise = resolveSheet(initial)
  for (const url of wanted.values()) prefetch(url)
  progress = {
    loaded: 0,
    total: wanted.size,
    ready: false,
    models: Object.fromEntries([...wanted.keys()].map(id => [id, { phase: 'descargando', at: 0 }])),
  }
  emit()
  console.info('[epp-model]', JSON.stringify({ phase: 'inicio', total: wanted.size, ids: [...wanted.keys()] }))

  const tf = await bootTf()
  const tm = window.tmImage
  const pending = new Map([...wanted.entries()].map(([id, url]) => [id, downloadOne(tf, tm, id, url)]))
  const sheet = await sheetPromise
  for (const id of ITEMS) {
    const nextUrl = sheet[id] || ''
    if (nextUrl === (wanted.get(id) || '')) continue
    resolved = { ...resolved, [id]: nextUrl }
    if (!nextUrl) {
      pending.delete(id)
      continue
    }
    wanted.set(id, nextUrl)
    pending.set(id, downloadOne(tf, tm, id, nextUrl))
  }
  resolved = { ...sheet }
  const active = [...pending.keys()]
  progress = { ...progress, total: active.length }
  emit()

  const downloaded = await Promise.all(active.map(id => pending.get(id)))
  for (const item of downloaded) {
    mark(item.id, 'calentando', { source: item.source })
    await warmup(item.model)
    mark(item.id, item.source === 'idb' || item.source === 'memory' ? 'cache' : 'listo', { source: item.source })
  }
  progress = { ...progress, ready: true }
  emit()
  console.info('[epp-model]', JSON.stringify({
    phase: 'listos',
    at: Math.round(performance.now() - startedAt),
    models: progress.models,
  }))

  const toSave = downloaded.filter(item => item.source === 'network' && item.layers)
  Promise.all(toSave.map(item => persist(tf, item.id, item.url, item.layers, item.metadata))).catch(err => {
    console.warn('No se pudieron guardar los modelos en el navegador', err)
  })
  return resolved
}

/** Empieza las tres descargas juntas en cuanto arranca la app. No vuelve a bajar los mismos URL. */
export function preloadModels() {
  if (!preloadPromise) {
    preloadPromise = runPreload().catch(err => {
      preloadPromise = null
      throw err
    })
  }
  return preloadPromise
}

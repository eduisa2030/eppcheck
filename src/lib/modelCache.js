import { ITEMS } from './models'
import { MODELS } from './config'
import { getModelUrls } from './api'
import { loadTM } from './tm'

const memory = new Map()
const prefetched = new Map()
let bootPromise = null
let preloadPromise = null
let engineCompileOnly = false
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
      const flags = { webglPack: false, compileOnly: false, parallelShader: false }
      try {
        tf.env().set('WEBGL_PACK', true)
        flags.webglPack = tf.env().getBool('WEBGL_PACK')
      } catch {}
      try {
        tf.env().set('ENGINE_COMPILE_ONLY', true)
        flags.compileOnly = tf.env().getBool('ENGINE_COMPILE_ONLY') === true
        tf.env().set('ENGINE_COMPILE_ONLY', false)
      } catch {}
      try {
        const gl = tf.backend()?.gpgpu?.gl || tf.backend()?.getGPGPUContext?.()?.gl
        flags.parallelShader = Boolean(gl?.getExtension?.('KHR_parallel_shader_compile'))
      } catch {}
      engineCompileOnly = flags.compileOnly
      console.info('[epp-model]', JSON.stringify({ phase: 'tf', flags }))
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

function sharedFetch(url) {
  const bag = typeof window !== 'undefined' ? window.__eppFiles : null
  if (bag?.has(url)) return bag.get(url)
  const controller = new AbortController()
  window.__eppAbort?.set(url, controller)
  const pending = fetch(url, { signal: controller.signal }).catch(err => {
    if (err?.name === 'AbortError') return null
    throw err
  })
  if (bag) bag.set(url, pending)
  return pending
}

function abortUrl(url) {
  window.__eppAbort?.get(url)?.abort()
}

async function fetchBundle(url) {
  const modelJsonUrl = url + 'model.json'
  const [modelRes, metaRes] = await Promise.all([
    sharedFetch(modelJsonUrl),
    sharedFetch(url + 'metadata.json'),
  ])
  if (!modelRes?.ok || !metaRes?.ok) throw new Error(`No se pudo descargar ${url}`)
  const modelJSON = await modelRes.json()
  const metadata = await metaRes.json()
  const specs = []
  const parts = []
  for (const group of modelJSON.weightsManifest || []) {
    const buffers = await Promise.all((group.paths || []).map(async (path) => {
      const weightUrl = new URL(path, modelJsonUrl).href
      rememberWeight(url, weightUrl)
      const response = await sharedFetch(weightUrl)
      if (!response?.ok) throw new Error(`No se pudieron leer los pesos de ${url}`)
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

function readIdbRecord(id, url) {
  try {
    const savedUrl = localStorage.getItem(storageKey(id, 'url'))
    const name = localStorage.getItem(storageKey(id, 'idb'))
    const metaRaw = localStorage.getItem(storageKey(id, 'meta'))
    if (savedUrl !== url || !name || !metaRaw) return null
    return { name, metadata: JSON.parse(metaRaw) }
  } catch {
    return null
  }
}

function rememberWeight(base, weightUrl) {
  const bag = window.__eppWeights || (window.__eppWeights = {})
  const list = bag[base] || (bag[base] = [])
  if (!list.includes(weightUrl)) list.push(weightUrl)
}

function abortModelFetches(url) {
  abortUrl(url + 'model.json')
  abortUrl(url + 'metadata.json')
  for (const weightUrl of window.__eppWeights?.[url] || []) abortUrl(weightUrl)
}

async function runPreload() {
  startedAt = performance.now()
  const initial = configUrls()
  resolved = { ...initial }
  const wanted = new Map(ITEMS.filter(id => initial[id]).map(id => [id, initial[id]]))
  const hits = []
  const misses = []
  for (const [id, url] of wanted) {
    const record = readIdbRecord(id, url)
    if (record) hits.push({ id, url, record })
    else misses.push({ id, url })
  }
  const sheetPromise = resolveSheet(initial)
  for (const { url } of misses) prefetch(url)
  for (const { url } of hits) abortModelFetches(url)
  progress = {
    loaded: 0,
    total: wanted.size,
    warmed: 0,
    ready: false,
    stage: 'red',
    models: Object.fromEntries([...wanted.keys()].map(id => [id, {
      phase: hits.some(hit => hit.id === id) ? 'descargado' : 'descargando',
      at: 0,
      source: hits.some(hit => hit.id === id) ? 'idb' : 'network',
    }])),
  }
  emit()
  console.info('[epp-model]', JSON.stringify({
    phase: 'inicio',
    total: wanted.size,
    ids: [...wanted.keys()],
    cache: hits.map(hit => hit.id),
    network: misses.map(miss => miss.id),
  }))

  const tf = await bootTf()
  const tm = window.tmImage
  const sheet = await sheetPromise
  for (const id of ITEMS) {
    const nextUrl = sheet[id] || ''
    if (nextUrl === (wanted.get(id) || '')) continue
    resolved = { ...resolved, [id]: nextUrl }
    wanted.set(id, nextUrl)
  }
  resolved = { ...sheet }

  const bundles = new Map()
  if (misses.length) {
    await Promise.all(misses.map(async ({ id, url }) => {
      const bundle = await prefetch(url)
      bundles.set(id, bundle)
      mark(id, 'descargado', { source: 'network' })
    }))
  }
  progress = { ...progress, stage: 'gpu', warmed: 0 }
  emit()
  console.info('[epp-model]', JSON.stringify({ phase: 'bytes', at: Math.round(performance.now() - startedAt) }))

  const built = []
  for (const [id, url] of wanted) {
    if (!url) continue
    mark(id, 'preparando', { source: hits.some(hit => hit.id === id) ? 'idb' : 'network' })
    const record = hits.find(hit => hit.id === id && hit.url === url)?.record
    let model
    let layers = null
    let metadata = null
    let source = 'network'
    if (record) {
      layers = await tf.loadLayersModel(record.name)
      metadata = record.metadata
      model = new tm.CustomMobileNet(layers, metadata)
      source = 'idb'
    } else {
      const bundle = bundles.get(id)
      try {
        layers = await layersFromBundle(tf, bundle)
      } catch (err) {
        console.warn('[epp-model] fromMemory falló, se carga desde la URL', id, err)
        layers = await tf.loadLayersModel(url + 'model.json')
      }
      metadata = bundle.metadata
      model = new tm.CustomMobileNet(layers, metadata)
    }
    memory.set(url, model)
    if (engineCompileOnly) {
      try { tf.env().set('ENGINE_COMPILE_ONLY', true) } catch {}
    }
    await warmup(model)
    if (engineCompileOnly) {
      try { tf.env().set('ENGINE_COMPILE_ONLY', false) } catch {}
    }
    built.push({ id, url, model, layers: source === 'network' ? layers : null, metadata, source })
    progress = { ...progress, warmed: built.length }
    mark(id, source === 'idb' ? 'cache' : 'listo', { source })
  }

  progress = { ...progress, ready: true, stage: 'listo' }
  emit()
  console.info('[epp-model]', JSON.stringify({
    phase: 'listos',
    at: Math.round(performance.now() - startedAt),
    models: progress.models,
  }))

  const toSave = built.filter(item => item.source === 'network' && item.layers)
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

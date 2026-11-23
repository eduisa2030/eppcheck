import { ITEMS } from './models'
import { MODELS } from './config'
import { getModelUrls } from './api'
import { loadTM } from './tm'

const memory = new Map()
const inflight = new Map()
let bootPromise = null
let preloadPromise = null
let resolved = null
let progress = { loaded: 0, total: 0, ready: false }
const listeners = new Set()

function emit() {
  listeners.forEach(fn => fn(progress))
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

async function fromIndexedDb(tf, tm, id, url) {
  const savedUrl = localStorage.getItem(storageKey(id, 'url'))
  const name = localStorage.getItem(storageKey(id, 'idb'))
  const metaRaw = localStorage.getItem(storageKey(id, 'meta'))
  if (savedUrl !== url || !name || !metaRaw) return null
  const metadata = JSON.parse(metaRaw)
  const layers = await tf.loadLayersModel(name)
  return new tm.CustomMobileNet(layers, metadata)
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
}

async function fromNetwork(tf, tm, id, url) {
  const response = await fetch(url + 'metadata.json')
  if (!response.ok) throw new Error(`No se pudo leer metadata de ${id}`)
  const metadata = await response.json()
  const layers = await tf.loadLayersModel(url + 'model.json')
  const model = new tm.CustomMobileNet(layers, metadata)
  await warmup(model)
  persist(tf, id, url, layers, metadata).catch(err => {
    console.warn('No se pudo guardar el modelo en el navegador', err)
  })
  return model
}

async function loadOne(id, url) {
  if (memory.has(url)) return memory.get(url)
  if (inflight.has(url)) return inflight.get(url)
  const job = (async () => {
    const tf = await bootTf()
    const tm = window.tmImage
    let model = null
    try {
      model = await fromIndexedDb(tf, tm, id, url)
      if (model) await warmup(model)
    } catch (err) {
      console.warn('Caché local inválida, se descarga el modelo', err)
      model = null
    }
    if (!model) model = await fromNetwork(tf, tm, id, url)
    memory.set(url, model)
    return model
  })()
  inflight.set(url, job)
  try {
    return await job
  } finally {
    inflight.delete(url)
  }
}

async function resolveUrls() {
  const urls = {}
  for (const id of ITEMS) urls[id] = normalizeUrl(MODELS[id] || '')
  try {
    const remote = await getModelUrls()
    if (remote && typeof remote === 'object') {
      for (const id of ITEMS) {
        if (typeof remote[id] === 'string') urls[id] = normalizeUrl(remote[id])
      }
    }
  } catch (err) {
    console.warn('No se pudieron leer los modelos de la hoja', err)
  }
  resolved = urls
  return urls
}

async function runPreload() {
  const urls = await resolveUrls()
  const jobs = ITEMS.filter(id => urls[id]).map(id => [id, urls[id]])
  progress = { loaded: 0, total: jobs.length, ready: false }
  emit()
  let loaded = 0
  await Promise.all(jobs.map(async ([id, url]) => {
    await loadOne(id, url)
    loaded += 1
    progress = { loaded, total: jobs.length, ready: false }
    emit()
  }))
  progress = { loaded, total: jobs.length, ready: true }
  emit()
  return urls
}

/** Descarga en paralelo y deja los modelos en memoria. Llamadas siguientes no recargan. */
export function preloadModels() {
  if (!preloadPromise) {
    preloadPromise = runPreload().catch(err => {
      preloadPromise = null
      throw err
    })
  }
  return preloadPromise
}
